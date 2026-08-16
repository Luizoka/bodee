import 'dotenv/config';

import { Pool } from 'pg';

import { ApiService, type ClaimedSync } from '../api/api.service';

function positiveEnvironmentValue(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function processClaimedSync(
  service: ApiService,
  claim: ClaimedSync,
  maxAttempts: number,
): Promise<void> {
  try {
    const result = await service.processOfflineSync(claim.id);
    if (!result) throw new Error('Sincronização não encontrada.');
    process.stdout.write(
      `${JSON.stringify({ event: 'worker.offline.completed', ...result })}\n`,
    );
  } catch {
    const status = await service.recordOfflineSyncFailure(
      claim.id,
      maxAttempts,
    );
    process.stderr.write(
      `${JSON.stringify({
        event: 'worker.offline.processing_failed',
        syncId: claim.id,
        attempts: claim.attempts,
        nextStatus: status,
      })}\n`,
    );
  }
}

async function processSpecificSync(
  service: ApiService,
  syncId: string,
  maxAttempts: number,
): Promise<void> {
  try {
    const result = await service.processOfflineSync(syncId);
    if (!result) throw new Error('Sincronização não encontrada.');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    await service.recordOfflineSyncFailure(syncId, maxAttempts);
    throw error;
  }
}

async function run(): Promise<void> {
  const argument = process.argv[2];
  const runOnce = argument === '--once';
  const syncId = argument && !runOnce ? argument : undefined;
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!databaseUrl || !encryptionKey) {
    throw new Error('DATABASE_URL e CREDENTIALS_ENCRYPTION_KEY são obrigatórias.');
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.',
    );
  }

  const pollIntervalMs = positiveEnvironmentValue('WORKER_POLL_INTERVAL_MS', 1_000);
  const staleAfterMs = positiveEnvironmentValue('WORKER_STALE_AFTER_MS', 300_000);
  const maxAttempts = positiveEnvironmentValue('WORKER_MAX_ATTEMPTS', 3);
  const pool = new Pool({ connectionString: databaseUrl });
  let running = true;
  const stop = () => {
    running = false;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    const service = new ApiService(pool, encryptionKey);
    await service.initialize();

    if (syncId) {
      await processSpecificSync(service, syncId, maxAttempts);
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        event: 'worker.offline.started',
        pollIntervalMs,
        maxAttempts,
      })}\n`,
    );
    do {
      const claim = await service.claimNextQueuedSync(staleAfterMs);
      if (claim) {
        process.stdout.write(
          `${JSON.stringify({
            event: 'worker.offline.claimed',
            syncId: claim.id,
            attempts: claim.attempts,
          })}\n`,
        );
        await processClaimedSync(service, claim, maxAttempts);
      } else if (runOnce) {
        break;
      } else {
        await sleep(pollIntervalMs);
      }
    } while (running);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha inesperada.';
  process.stderr.write(`worker.offline.failed: ${message}\n`);
  process.exitCode = 1;
});
