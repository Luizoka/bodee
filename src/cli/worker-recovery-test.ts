import 'dotenv/config';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { ApiService } from '../api/api.service';

function report(step: string): void {
  process.stdout.write(`${JSON.stringify({ event: 'worker.recovery.step', step })}\n`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runWorker(
  syncId: string,
  provider: 'offline' | 'equatorial',
  maxAttempts: number,
): Promise<{ code: number | null; stderr: string }> {
  const tsxCli = require.resolve('tsx/cli');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [tsxCli, 'src/cli/process-offline-sync.ts', syncId],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SYNC_PROVIDER: provider,
          WORKER_MAX_ATTEMPTS: String(maxAttempts),
          WORKER_RETRY_BASE_DELAY_MS: '0',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!databaseUrl || !encryptionKey) {
    throw new Error('DATABASE_URL e CREDENTIALS_ENCRYPTION_KEY são obrigatórias.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const service = new ApiService(pool, encryptionKey);
  let clientId: number | undefined;
  try {
    await service.initialize();
    const suffix = randomUUID().slice(0, 8);
    const client = await service.createClient({
      type: 'PF',
      name: `Teste recovery ${suffix}`,
      document: '44444444444',
      birthDate: '01/01/1990',
    });
    clientId = Number(client.id);
    const account = `recovery-${suffix}`;
    await service.addAccount(clientId, account);
    await service.setEquatorialCredentials(clientId, {
      document: '44444444444',
      birthDate: '01/01/1990',
    });
    report('dados_temporarios_criados');

    const retrySync = await service.createSync(clientId, [
      { account, competence: '2026/10' },
    ]);
    assert(retrySync, 'Não foi possível criar a sincronização de recuperação.');
    const failedWorker = await runWorker(retrySync.syncId, 'equatorial', 3);
    assert(failedWorker.code === 1, 'O worker com provider indisponível deveria falhar.');
    const queuedAfterFailure = await service.getSync(retrySync.syncId, clientId);
    assert(
      queuedAfterFailure?.status === 'QUEUED' && queuedAfterFailure.attempts === 1,
      'A falha temporária deveria devolver a sincronização para QUEUED.',
    );
    report('falha_temporaria_reenfileirada');

    const restartedWorker = await runWorker(retrySync.syncId, 'offline', 3);
    assert(restartedWorker.code === 0, 'O worker reiniciado deveria concluir a sincronização.');
    const completedAfterRestart = await service.getSync(retrySync.syncId, clientId);
    assert(
      completedAfterRestart?.status === 'COMPLETED',
      'A sincronização não foi concluída após reiniciar o worker.',
    );
    report('worker_reiniciado_concluiu_sincronizacao');

    const terminalSync = await service.createSync(clientId, [
      { account, competence: '2026/11' },
    ]);
    assert(terminalSync, 'Não foi possível criar a sincronização de falha terminal.');
    const terminalWorker = await runWorker(terminalSync.syncId, 'equatorial', 1);
    assert(terminalWorker.code === 1, 'O worker de falha terminal deveria encerrar com erro.');
    const failed = await service.getSync(terminalSync.syncId, clientId);
    assert(failed?.status === 'FAILED', 'A sincronização deveria terminar em FAILED.');
    report('falha_terminal_registrada');

    assert(await service.requeueFailedSync(terminalSync.syncId), 'Não foi possível reprocessar a falha.');
    const recoveredWorker = await runWorker(terminalSync.syncId, 'offline', 3);
    assert(recoveredWorker.code === 0, 'O worker deveria concluir após reprocessamento manual.');
    const recovered = await service.getSync(terminalSync.syncId, clientId);
    assert(recovered?.status === 'COMPLETED', 'A falha reprocessada não foi concluída.');
    report('falha_terminal_reprocessada_com_sucesso');

    process.stdout.write(`${JSON.stringify({ event: 'worker.recovery.passed' })}\n`);
  } finally {
    if (clientId) await service.deleteClient(clientId);
    await pool.end();
    process.stdout.write(`${JSON.stringify({ event: 'worker.recovery.cleanup_completed' })}\n`);
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha inesperada.';
  process.stderr.write(`worker.recovery.failed: ${message}\n`);
  process.exitCode = 1;
});
