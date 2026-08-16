import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

interface JsonResponse {
  response: Response;
  body: Record<string, unknown>;
}

function assertStatus(response: Response, expected: number, step: string): void {
  if (response.status !== expected) {
    throw new Error(
      `${step}: esperado HTTP ${expected}, recebido HTTP ${response.status}.`,
    );
  }
}

function reportStep(step: string): void {
  process.stdout.write(`${JSON.stringify({ event: 'api.flow.step', step })}\n`);
}

async function requestJson(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { response, body };
}

async function runOfflineWorker(syncId: string): Promise<void> {
  const tsxCli = require.resolve('tsx/cli');
  const workerArguments =
    process.env.API_FLOW_WORKER_MODE === 'queue' ? ['--once'] : [syncId];
  await new Promise<void>((resolve, reject) => {
    const worker = spawn(
      process.execPath,
      [tsxCli, 'src/cli/process-offline-sync.ts', ...workerArguments],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    worker.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    worker.on('error', reject);
    worker.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Worker offline falhou: ${stderr.trim()}`));
    });
  });
}

async function run(): Promise<void> {
  const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(
    /\/$/,
    '',
  );
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey) throw new Error('ADMIN_API_KEY não configurada.');

  const adminHeaders = {
    authorization: `Bearer ${adminApiKey}`,
    'content-type': 'application/json',
  };
  const suffix = randomUUID().slice(0, 8);
  const testClientIds: number[] = [];

  try {
    const health = await requestJson(baseUrl, '/health');
    assertStatus(health.response, 200, 'health check');
    reportStep('health_check_ok');

    const unauthenticatedAdmin = await requestJson(baseUrl, '/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assertStatus(unauthenticatedAdmin.response, 401, 'admin sem chave');
    reportStep('admin_sem_chave_bloqueado');

    const createClient = async (name: string, document: string): Promise<number> => {
      const created = await requestJson(baseUrl, '/clients', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          type: 'PF',
          name,
          document,
          birthDate: '01/01/1990',
        }),
      });
      assertStatus(created.response, 201, 'criação de cliente');
      const id = Number(created.body.id);
      if (!Number.isInteger(id)) throw new Error('Cliente criado sem id válido.');
      testClientIds.push(id);
      return id;
    };

    const clientA = await createClient(`Fluxo A ${suffix}`, '00000000000');
    const clientB = await createClient(`Fluxo B ${suffix}`, '11111111111');
    reportStep('clientes_criados_com_chave_administrativa');
    const account = `flow-${suffix}`;

    for (const clientId of [clientA, clientB]) {
      const accountResponse = await requestJson(
        baseUrl,
        `/clients/${clientId}/accounts`,
        {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ account }),
        },
      );
      assertStatus(accountResponse.response, 201, 'associação de conta');
    }
    reportStep('contas_associadas_aos_clientes');

    const issueKey = async (clientId: number): Promise<{ id: string; value: string }> => {
      const key = await requestJson(baseUrl, `/clients/${clientId}/api-keys`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ label: `fluxo ${suffix}` }),
      });
      assertStatus(key.response, 201, 'emissão de API key');
      if (typeof key.body.id !== 'string' || typeof key.body.apiKey !== 'string') {
        throw new Error('API key não foi retornada corretamente.');
      }
      return { id: key.body.id, value: key.body.apiKey };
    };

    const keyA = await issueKey(clientA);
    const keyB = await issueKey(clientB);
    reportStep('api_keys_de_clientes_emitidas');
    const clientAHeaders = {
      authorization: `Bearer ${keyA.value}`,
      'content-type': 'application/json',
    };
    const clientBHeaders = { authorization: `Bearer ${keyB.value}` };

    const unauthenticatedInvoices = await requestJson(baseUrl, '/invoices');
    assertStatus(unauthenticatedInvoices.response, 401, 'faturas sem API key');
    reportStep('faturas_sem_chave_bloqueadas');

    const sync = await requestJson(baseUrl, '/sync', {
      method: 'POST',
      headers: clientAHeaders,
      body: JSON.stringify({
        accounts: [{ account, competences: ['2026/08'] }],
      }),
    });
    assertStatus(sync.response, 201, 'criação da sincronização');
    if (typeof sync.body.syncId !== 'string') {
      throw new Error('Sincronização criada sem id válido.');
    }
    const syncId = sync.body.syncId;
    reportStep('sincronizacao_criada_pelo_cliente_autenticado');

    const ownSync = await requestJson(baseUrl, `/sync/${syncId}`, {
      headers: clientAHeaders,
    });
    assertStatus(ownSync.response, 200, 'leitura da sincronização do dono');
    reportStep('cliente_dono_consulta_sua_sincronizacao');

    const foreignSync = await requestJson(baseUrl, `/sync/${syncId}`, {
      headers: clientBHeaders,
    });
    assertStatus(foreignSync.response, 404, 'isolamento entre clientes');
    reportStep('cliente_estranho_nao_acessa_sincronizacao_alheia');

    await runOfflineWorker(syncId);
    reportStep(
      process.env.API_FLOW_WORKER_MODE === 'queue'
        ? 'worker_da_fila_processou_a_sincronizacao'
        : 'worker_offline_processou_a_sincronizacao',
    );

    const invoicesA = await requestJson(baseUrl, '/invoices', {
      headers: clientAHeaders,
    });
    assertStatus(invoicesA.response, 200, 'listagem de faturas do dono');
    if (!Array.isArray(invoicesA.body) || invoicesA.body.length !== 1) {
      throw new Error('O cliente dono não recebeu a fatura esperada.');
    }
    reportStep('cliente_dono_recebe_sua_fatura');

    const invoicesB = await requestJson(baseUrl, '/invoices', {
      headers: clientBHeaders,
    });
    assertStatus(invoicesB.response, 200, 'listagem de faturas do outro cliente');
    if (!Array.isArray(invoicesB.body) || invoicesB.body.length !== 0) {
      throw new Error('O outro cliente recebeu faturas que não lhe pertencem.');
    }
    reportStep('cliente_estranho_nao_recebe_faturas_alheias');

    const revoked = await requestJson(
      baseUrl,
      `/clients/${clientA}/api-keys/${keyA.id}`,
      { method: 'DELETE', headers: adminHeaders },
    );
    assertStatus(revoked.response, 200, 'revogação de API key');
    reportStep('api_key_revogada');

    const revokedKeyRequest = await requestJson(baseUrl, '/invoices', {
      headers: clientAHeaders,
    });
    assertStatus(revokedKeyRequest.response, 401, 'bloqueio de chave revogada');
    reportStep('api_key_revogada_bloqueada');

    process.stdout.write(
      `${JSON.stringify({ event: 'api.flow.passed', baseUrl, syncId })}\n`,
    );
  } finally {
    for (const clientId of testClientIds.reverse()) {
      await requestJson(baseUrl, `/clients/${clientId}`, {
        method: 'DELETE',
        headers: adminHeaders,
      }).catch(() => undefined);
    }
    if (testClientIds.length > 0) reportStep('dados_temporarios_removidos');
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha inesperada.';
  process.stderr.write(`api.flow.failed: ${message}\n`);
  process.exitCode = 1;
});
