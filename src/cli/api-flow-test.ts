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

async function waitForWorker(
  baseUrl: string,
  syncId: string,
  headers: HeadersInit,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const sync = await requestJson(baseUrl, `/sync/${syncId}`, { headers });
    assertStatus(sync.response, 200, 'consulta durante o processamento');
    if (sync.body.status === 'COMPLETED') return;
    if (sync.body.status === 'FAILED') {
      throw new Error('O worker marcou a sincronização como FAILED.');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('O worker contínuo não concluiu a sincronização em 15 segundos.');
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
  const useRunningWorker =
    process.argv.includes('--use-running-worker') ||
    process.env.API_FLOW_USE_RUNNING_WORKER === 'true';
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

    const unauthenticatedAdminRuns = await requestJson(baseUrl, '/admin/sync-runs');
    assertStatus(unauthenticatedAdminRuns.response, 401, 'fila administrativa sem chave');
    reportStep('fila_administrativa_sem_chave_bloqueada');

    const unauthenticatedAudit = await requestJson(baseUrl, '/admin/audit-logs');
    assertStatus(unauthenticatedAudit.response, 401, 'auditoria sem chave');
    reportStep('auditoria_sem_chave_bloqueada');

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
    const credentials = await requestJson(
      baseUrl,
      `/clients/${clientA}/providers/equatorial/credentials`,
      {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          document: '00000000000',
          birthDate: '01/01/1990',
        }),
      },
    );
    assertStatus(credentials.response, 200, 'cadastro de credenciais');
    if (credentials.body.configured !== true) {
      throw new Error('Credenciais não foram marcadas como configuradas.');
    }
    const credentialStatus = await requestJson(
      baseUrl,
      `/clients/${clientA}/providers/equatorial/credentials/status`,
      { headers: adminHeaders },
    );
    assertStatus(credentialStatus.response, 200, 'status de credenciais');
    if (credentialStatus.body.configured !== true) {
      throw new Error('Status de credenciais não foi atualizado.');
    }
    reportStep('credenciais_equatorial_criptografadas_e_configuradas');
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

    const adminRuns = await requestJson(baseUrl, '/admin/sync-runs?status=QUEUED', {
      headers: adminHeaders,
    });
    assertStatus(adminRuns.response, 200, 'listagem administrativa da fila');
    if (
      !Array.isArray(adminRuns.body) ||
      !adminRuns.body.some((run) => (run as Record<string, unknown>).id === syncId)
    ) {
      throw new Error('A sincronização não apareceu na fila administrativa.');
    }
    reportStep('administrador_consulta_fila');

    const auditLogs = await requestJson(baseUrl, '/admin/audit-logs?limit=100', {
      headers: adminHeaders,
    });
    assertStatus(auditLogs.response, 200, 'consulta de auditoria');
    if (
      !Array.isArray(auditLogs.body) ||
      !auditLogs.body.some(
        (log) =>
          (log as Record<string, unknown>).action === 'sync.requested' &&
          (log as Record<string, unknown>).resource_id === syncId,
      )
    ) {
      throw new Error('A solicitação de sincronização não foi auditada.');
    }
    reportStep('administrador_consulta_auditoria');

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

    if (useRunningWorker) {
      await waitForWorker(baseUrl, syncId, clientAHeaders);
      reportStep('worker_continuo_processou_a_sincronizacao');
    } else {
      await runOfflineWorker(syncId);
      reportStep(
        process.env.API_FLOW_WORKER_MODE === 'queue'
          ? 'worker_da_fila_processou_a_sincronizacao'
          : 'worker_offline_processou_a_sincronizacao',
      );
    }

    const invoicesA = await requestJson(baseUrl, '/invoices', {
      headers: clientAHeaders,
    });
    assertStatus(invoicesA.response, 200, 'listagem de faturas do dono');
    if (!Array.isArray(invoicesA.body) || invoicesA.body.length !== 1) {
      throw new Error('O cliente dono não recebeu a fatura esperada.');
    }
    reportStep('cliente_dono_recebe_sua_fatura');
    const invoice = invoicesA.body[0] as Record<string, unknown>;
    const invoiceId = Number(invoice.id);
    if (!Number.isInteger(invoiceId)) {
      throw new Error('Fatura criada sem id válido.');
    }
    const download = await fetch(`${baseUrl}/invoices/${invoiceId}/download`, {
      headers: clientAHeaders,
    });
    assertStatus(download, 200, 'download de fatura do dono');
    const signature = Buffer.from(await download.arrayBuffer())
      .subarray(0, 5)
      .toString();
    if (signature !== '%PDF-') {
      throw new Error('Download não retornou um PDF válido.');
    }
    reportStep('cliente_dono_baixa_pdf_privado');

    const invoicesB = await requestJson(baseUrl, '/invoices', {
      headers: clientBHeaders,
    });
    assertStatus(invoicesB.response, 200, 'listagem de faturas do outro cliente');
    if (!Array.isArray(invoicesB.body) || invoicesB.body.length !== 0) {
      throw new Error('O outro cliente recebeu faturas que não lhe pertencem.');
    }
    reportStep('cliente_estranho_nao_recebe_faturas_alheias');
    const foreignDownload = await fetch(
      `${baseUrl}/invoices/${invoiceId}/download`,
      { headers: clientBHeaders },
    );
    assertStatus(foreignDownload, 404, 'download de fatura de outro cliente');
    reportStep('cliente_estranho_nao_baixa_pdf_alheio');

    const revoked = await requestJson(
      baseUrl,
      `/clients/${clientA}/api-keys/${keyA.id}`,
      { method: 'DELETE', headers: adminHeaders },
    );
    assertStatus(revoked.response, 200, 'revogação de API key');
    reportStep('api_key_revogada');

    const removedCredentials = await requestJson(
      baseUrl,
      `/clients/${clientA}/providers/equatorial/credentials`,
      { method: 'DELETE', headers: adminHeaders },
    );
    assertStatus(removedCredentials.response, 200, 'remoção de credenciais');
    reportStep('credenciais_equatorial_removidas');

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
