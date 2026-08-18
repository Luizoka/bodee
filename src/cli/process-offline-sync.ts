import 'dotenv/config';

import { Pool } from 'pg';

import { ApiService, type ClaimedSync } from '../api/api.service';
import { createInvoiceStorage } from '../api/invoice-storage.factory';
import { EquatorialInvoiceProvider } from '../providers/equatorial-invoice.provider';
import type { InvoiceSyncProvider } from '../providers/invoice-sync.provider';
import { OfflineInvoiceProvider } from '../providers/offline-invoice.provider';

function positiveEnvironmentValue(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeEnvironmentValue(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createProvider(service: ApiService): InvoiceSyncProvider {
  const provider = process.env.SYNC_PROVIDER ?? 'offline';
  if (provider === 'offline') return new OfflineInvoiceProvider();
  if (provider === 'equatorial') {
    return new EquatorialInvoiceProvider((clientId) =>
      service.getEquatorialCredentialsForWorker(clientId),
    );
  }
  throw new Error('SYNC_PROVIDER deve ser offline ou equatorial.');
}

async function processClaimedSync(
  service: ApiService,
  claim: ClaimedSync,
  maxAttempts: number,
  retryBaseDelayMs: number,
  provider: InvoiceSyncProvider,
): Promise<void> {
  try {
    const result = await service.processSync(claim.id, provider);
    if (!result) throw new Error('Sincronização não encontrada.');
    process.stdout.write(
      `${JSON.stringify({ event: 'worker.completed', ...result })}\n`,
    );
  } catch {
    const status = await service.recordOfflineSyncFailure(
      claim.id,
      maxAttempts,
      retryBaseDelayMs,
    );
    process.stderr.write(
      `${JSON.stringify({
        event: 'worker.processing_failed',
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
  retryBaseDelayMs: number,
  staleAfterMs: number,
  provider: InvoiceSyncProvider,
): Promise<void> {
  const claim = await service.claimSyncById(syncId, staleAfterMs);
  if (!claim)
    throw new Error('Sincronização não está disponível para processamento.');
  try {
    const result = await service.processSync(syncId, provider);
    if (!result) throw new Error('Sincronização não encontrada.');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    await service.recordOfflineSyncFailure(
      syncId,
      maxAttempts,
      retryBaseDelayMs,
    );
    throw error;
  }
}

async function run(): Promise<void> {
  const argument = process.argv.slice(2).find((value) => value !== '--');
  const runOnce = argument === '--once';
  const syncId = argument && !runOnce ? argument : undefined;
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!databaseUrl || !encryptionKey) {
    throw new Error(
      'DATABASE_URL e CREDENTIALS_ENCRYPTION_KEY são obrigatórias.',
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.',
    );
  }

  const pollIntervalMs = positiveEnvironmentValue(
    'WORKER_POLL_INTERVAL_MS',
    1_000,
  );
  const staleAfterMs = positiveEnvironmentValue(
    'WORKER_STALE_AFTER_MS',
    300_000,
  );
  const maxAttempts = positiveEnvironmentValue('WORKER_MAX_ATTEMPTS', 3);
  const retryBaseDelayMs = nonNegativeEnvironmentValue(
    'WORKER_RETRY_BASE_DELAY_MS',
    10_000,
  );
  const pool = new Pool({ connectionString: databaseUrl });
  let running = true;
  const stop = () => {
    running = false;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    const service = new ApiService(pool, encryptionKey, createInvoiceStorage());
    await service.initialize();
    const provider = createProvider(service);

    if (syncId) {
      await processSpecificSync(
        service,
        syncId,
        maxAttempts,
        retryBaseDelayMs,
        staleAfterMs,
        provider,
      );
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        event: 'worker.started',
        pollIntervalMs,
        maxAttempts,
        retryBaseDelayMs,
        provider: provider.name,
      })}\n`,
    );
    do {
      const claim = await service.claimNextQueuedSync(staleAfterMs);
      if (claim) {
        process.stdout.write(
          `${JSON.stringify({
            event: 'worker.claimed',
            syncId: claim.id,
            attempts: claim.attempts,
          })}\n`,
        );
        await processClaimedSync(
          service,
          claim,
          maxAttempts,
          retryBaseDelayMs,
          provider,
        );
        if (runOnce) break;
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
  process.stderr.write(`worker.failed: ${message}\n`);
  process.exitCode = 1;
});
