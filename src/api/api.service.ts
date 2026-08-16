import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { LocalInvoiceStorageService } from './local-invoice-storage.service';
import { OfflineInvoiceProvider } from '../providers/offline-invoice.provider';
import type { InvoiceSyncProvider } from '../providers/invoice-sync.provider';

type ClientType = 'PF' | 'PJ';

interface CreateClientInput {
  type: ClientType;
  name: string;
  document: string;
  birthDate?: string | undefined;
  email?: string | undefined;
}

interface SyncItemInput {
  account: string;
  competence: string;
}

type SyncRunStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface EquatorialCredentials {
  document: string;
  birthDate: string;
}

export interface ClaimedSync {
  id: string;
  attempts: number;
}

export interface MonthlyScheduleResult {
  competence: string;
  syncsCreated: number;
  itemsCreated: number;
  syncIds: string[];
}

function encrypt(value: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((part) => part.toString('base64url'))
    .join('.');
}

function decrypt(value: string, keyHex: string): string {
  const [ivValue, tagValue, bodyValue] = value.split('.');
  if (!ivValue || !tagValue || !bodyValue) {
    throw new Error('Credencial criptografada inválida.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function hashApiKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class ApiService {
  constructor(
    private readonly pool: Pool,
    private readonly key: string,
    private readonly storage = new LocalInvoiceStorageService(),
  ) {}

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('PF','PJ')),
        name TEXT NOT NULL,
        document_encrypted TEXT NOT NULL,
        birth_date_encrypted TEXT,
        email_encrypted TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS client_accounts (
        id BIGSERIAL PRIMARY KEY,
        client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        account TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE(client_id, account)
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id BIGSERIAL PRIMARY KEY,
        account TEXT NOT NULL,
        competence TEXT NOT NULL,
        file_path TEXT NOT NULL,
        sha256 CHAR(64) NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('DOWNLOADED', 'SENT', 'SEND_FAILED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        UNIQUE (account, competence)
      );
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id);
      CREATE TABLE IF NOT EXISTS sync_runs (
        id UUID PRIMARY KEY,
        client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
        total INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS sync_items (
        id BIGSERIAL PRIMARY KEY,
        sync_id UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
        client_id BIGINT NOT NULL REFERENCES clients(id),
        account TEXT NOT NULL,
        competence TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
        error TEXT
      );
      ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE;
      ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
      ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS last_error TEXT;
      ALTER TABLE sync_items DROP CONSTRAINT IF EXISTS sync_items_client_id_fkey;
      ALTER TABLE sync_items ADD CONSTRAINT sync_items_client_id_fkey
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY,
        client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash CHAR(64) NOT NULL UNIQUE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS provider_credentials (
        client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('EQUATORIAL')),
        document_encrypted TEXT NOT NULL,
        birth_date_encrypted TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (client_id, provider)
      );
    `);
  }

  async health(): Promise<{ status: 'ok' }> {
    await this.pool.query('SELECT 1');
    return { status: 'ok' };
  }

  async createClient(input: CreateClientInput) {
    const result = await this.pool.query(
      `INSERT INTO clients (type,name,document_encrypted,birth_date_encrypted,email_encrypted)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,type,name,active,created_at`,
      [
        input.type,
        input.name,
        encrypt(input.document, this.key),
        input.birthDate ? encrypt(input.birthDate, this.key) : null,
        input.email ? encrypt(input.email, this.key) : null,
      ],
    );
    return result.rows[0];
  }

  async addAccount(clientId: number, account: string) {
    const client = await this.pool.query(
      'SELECT id FROM clients WHERE id = $1 AND active = TRUE',
      [clientId],
    );
    if (!client.rows[0]) return undefined;

    const result = await this.pool.query(
      `INSERT INTO client_accounts (client_id,account) VALUES ($1,$2)
       ON CONFLICT (client_id,account) DO UPDATE SET active=TRUE
       RETURNING id,client_id,account,active`,
      [clientId, account],
    );
    return result.rows[0];
  }

  async deleteClient(clientId: number): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const existing = await connection.query(
        'SELECT id FROM clients WHERE id = $1 FOR UPDATE',
        [clientId],
      );
      if (!existing.rows[0]) {
        await connection.query('ROLLBACK');
        return false;
      }
      await connection.query('DELETE FROM invoices WHERE client_id = $1', [
        clientId,
      ]);
      await connection.query('DELETE FROM clients WHERE id = $1', [clientId]);
      await connection.query('COMMIT');
      await this.storage.removeClientFiles(clientId);
      return true;
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async setEquatorialCredentials(
    clientId: number,
    credentials: EquatorialCredentials,
  ): Promise<boolean> {
    const client = await this.pool.query(
      'SELECT id FROM clients WHERE id = $1 AND active = TRUE',
      [clientId],
    );
    if (!client.rows[0]) return false;

    await this.pool.query(
      `INSERT INTO provider_credentials
         (client_id, provider, document_encrypted, birth_date_encrypted)
       VALUES ($1, 'EQUATORIAL', $2, $3)
       ON CONFLICT (client_id, provider) DO UPDATE SET
         document_encrypted = EXCLUDED.document_encrypted,
         birth_date_encrypted = EXCLUDED.birth_date_encrypted,
         updated_at = NOW()`,
      [
        clientId,
        encrypt(credentials.document, this.key),
        encrypt(credentials.birthDate, this.key),
      ],
    );
    return true;
  }

  async getEquatorialCredentialStatus(clientId: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM provider_credentials
       WHERE client_id = $1 AND provider = 'EQUATORIAL'`,
      [clientId],
    );
    return Boolean(result.rows[0]);
  }

  async getEquatorialCredentialsForWorker(
    clientId: number,
  ): Promise<EquatorialCredentials | undefined> {
    const result = await this.pool.query<{
      document_encrypted: string;
      birth_date_encrypted: string;
    }>(
      `SELECT document_encrypted, birth_date_encrypted
       FROM provider_credentials
       WHERE client_id = $1 AND provider = 'EQUATORIAL'`,
      [clientId],
    );
    const credentials = result.rows[0];
    if (!credentials) return undefined;
    return {
      document: decrypt(credentials.document_encrypted, this.key),
      birthDate: decrypt(credentials.birth_date_encrypted, this.key),
    };
  }

  async deleteEquatorialCredentials(clientId: number): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM provider_credentials
       WHERE client_id = $1 AND provider = 'EQUATORIAL'`,
      [clientId],
    );
    return result.rowCount === 1;
  }

  async createClientApiKey(clientId: number, label: string) {
    const client = await this.pool.query(
      'SELECT id FROM clients WHERE id = $1 AND active = TRUE',
      [clientId],
    );
    if (!client.rows[0]) return undefined;

    const apiKey = `fsk_${randomBytes(32).toString('base64url')}`;
    const keyPrefix = apiKey.slice(0, 12);
    const result = await this.pool.query(
      `INSERT INTO api_keys (id,client_id,label,key_prefix,key_hash)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,client_id,label,key_prefix,created_at`,
      [randomUUID(), clientId, label, keyPrefix, hashApiKey(apiKey)],
    );

    return { ...result.rows[0], apiKey };
  }

  async revokeClientApiKey(clientId: number, keyId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE api_keys SET active = FALSE, revoked_at = NOW()
       WHERE id = $1 AND client_id = $2 AND active = TRUE`,
      [keyId, clientId],
    );
    return result.rowCount === 1;
  }

  async authenticateApiKey(apiKey: string): Promise<number | undefined> {
    const result = await this.pool.query(
      `SELECT api_keys.client_id
       FROM api_keys
       INNER JOIN clients ON clients.id = api_keys.client_id
       WHERE api_keys.key_hash = $1
         AND api_keys.active = TRUE
         AND clients.active = TRUE`,
      [hashApiKey(apiKey)],
    );
    const clientId = result.rows[0]?.client_id;
    return typeof clientId === 'string' ? Number(clientId) : clientId;
  }

  async createSync(clientId: number, inputItems: SyncItemInput[]) {
    const items = [
      ...new Map(
        inputItems.map((item) => [`${item.account}:${item.competence}`, item]),
      ).values(),
    ];
    const connection = await this.pool.connect();

    try {
      await connection.query('BEGIN');
      const client = await connection.query(
        'SELECT id FROM clients WHERE id = $1 AND active = TRUE',
        [clientId],
      );
      if (!client.rows[0]) {
        await connection.query('ROLLBACK');
        return undefined;
      }

      const requestedAccounts = [...new Set(items.map((item) => item.account))];
      const accounts = await connection.query(
        `SELECT account FROM client_accounts
         WHERE client_id = $1 AND active = TRUE AND account = ANY($2::text[])`,
        [clientId, requestedAccounts],
      );
      if (accounts.rowCount !== requestedAccounts.length) {
        throw new Error('Todas as contas da sincronização devem pertencer ao cliente.');
      }

      const id = randomUUID();
      await connection.query(
        `INSERT INTO sync_runs (id,client_id,status,total)
         VALUES ($1,$2,'QUEUED',$3)`,
        [id, clientId, items.length],
      );
      for (const item of items) {
        await connection.query(
          `INSERT INTO sync_items (sync_id,client_id,account,competence)
           VALUES ($1,$2,$3,$4)`,
          [id, clientId, item.account, item.competence],
        );
      }
      await connection.query('COMMIT');
      return { syncId: id, status: 'QUEUED' as const, total: items.length };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  /** Enfileira apenas contas que ainda não têm fatura ou trabalho ativo. */
  async scheduleMonthlySyncs(competence: string): Promise<MonthlyScheduleResult> {
    if (!/^\d{4}\/(0[1-9]|1[0-2])$/.test(competence)) {
      throw new Error('Competência deve estar no formato AAAA/MM.');
    }

    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const clients = await connection.query<{ id: number }>(
        'SELECT id FROM clients WHERE active = TRUE ORDER BY id FOR UPDATE',
      );
      const syncIds: string[] = [];
      let itemsCreated = 0;

      for (const client of clients.rows) {
        const clientId = Number(client.id);
        const accounts = await connection.query<{ account: string }>(
          `SELECT account FROM client_accounts
           WHERE client_id = $1 AND active = TRUE
           ORDER BY id FOR UPDATE`,
          [clientId],
        );
        if (accounts.rowCount === 0) continue;

        const pending = await connection.query<{ account: string }>(
          `SELECT candidate.account
           FROM unnest($2::text[]) AS candidate(account)
           WHERE NOT EXISTS (
             SELECT 1 FROM invoices invoice
             WHERE invoice.client_id = $1 AND invoice.account = candidate.account
               AND invoice.competence = $3
           )
           AND NOT EXISTS (
             SELECT 1 FROM sync_items item
             INNER JOIN sync_runs run ON run.id = item.sync_id
             WHERE item.client_id = $1 AND item.account = candidate.account
               AND item.competence = $3
               AND run.status IN ('QUEUED', 'PROCESSING')
           )`,
          [
            clientId,
            accounts.rows.map((account) => account.account),
            competence,
          ],
        );
        if (pending.rows.length === 0) continue;

        const syncId = randomUUID();
        await connection.query(
          `INSERT INTO sync_runs (id,client_id,status,total)
           VALUES ($1,$2,'QUEUED',$3)`,
          [syncId, clientId, pending.rows.length],
        );
        for (const item of pending.rows) {
          await connection.query(
            `INSERT INTO sync_items (sync_id,client_id,account,competence)
             VALUES ($1,$2,$3,$4)`,
            [syncId, clientId, item.account, competence],
          );
        }
        syncIds.push(syncId);
        itemsCreated += pending.rows.length;
      }

      await connection.query('COMMIT');
      return { competence, syncsCreated: syncIds.length, itemsCreated, syncIds };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async listAdminSyncRuns(status?: SyncRunStatus, limit = 50) {
    const values: (string | number)[] = [];
    const where = status
      ? (values.push(status), 'WHERE run.status = $1')
      : '';
    values.push(limit);
    const runs = await this.pool.query(
      `SELECT run.id,run.client_id,client.name AS client_name,run.status,
              run.total,run.completed,run.failed,run.attempts,run.last_error,
              run.created_at,run.started_at,run.finished_at
       FROM sync_runs run
       INNER JOIN clients client ON client.id = run.client_id
       ${where}
       ORDER BY run.created_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return runs.rows;
  }

  async requeueFailedSync(id: string): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const run = await connection.query<{ status: SyncRunStatus }>(
        'SELECT status FROM sync_runs WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (run.rows[0]?.status !== 'FAILED') {
        await connection.query('ROLLBACK');
        return false;
      }
      await connection.query(
        `UPDATE sync_items SET status = 'PENDING', error = NULL
         WHERE sync_id = $1 AND status = 'FAILED'`,
        [id],
      );
      await connection.query(
        `UPDATE sync_runs
         SET status = 'QUEUED', completed = 0, failed = 0, attempts = 0,
             started_at = NULL, finished_at = NULL, last_error = NULL
         WHERE id = $1`,
        [id],
      );
      await connection.query('COMMIT');
      return true;
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimNextQueuedSync(staleAfterMs: number): Promise<ClaimedSync | undefined> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const run = await connection.query<{ id: string; attempts: number }>(
        `SELECT id, attempts
         FROM sync_runs
         WHERE status = 'QUEUED'
            OR (
              status = 'PROCESSING'
              AND started_at < NOW() - ($1::text || ' milliseconds')::interval
            )
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [String(staleAfterMs)],
      );
      const claimed = run.rows[0];
      if (!claimed) {
        await connection.query('ROLLBACK');
        return undefined;
      }

      const updated = await connection.query<{ attempts: number }>(
        `UPDATE sync_runs
         SET status = 'PROCESSING',
             attempts = attempts + 1,
             started_at = NOW(),
             finished_at = NULL,
             last_error = NULL
         WHERE id = $1
         RETURNING attempts`,
        [claimed.id],
      );
      await connection.query('COMMIT');
      return { id: claimed.id, attempts: updated.rows[0]?.attempts ?? 1 };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordOfflineSyncFailure(
    id: string,
    maxAttempts: number,
  ): Promise<'QUEUED' | 'FAILED' | undefined> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const run = await connection.query<{ attempts: number; total: number }>(
        'SELECT attempts, total FROM sync_runs WHERE id = $1 FOR UPDATE',
        [id],
      );
      const failedRun = run.rows[0];
      if (!failedRun) {
        await connection.query('ROLLBACK');
        return undefined;
      }

      const status = failedRun.attempts >= maxAttempts ? 'FAILED' : 'QUEUED';
      const error = 'Processamento offline não foi concluído.';
      await connection.query(
        `UPDATE sync_items
         SET status = CASE WHEN $2 = 'FAILED' THEN 'FAILED' ELSE 'PENDING' END,
             error = $3
         WHERE sync_id = $1 AND status IN ('PENDING', 'PROCESSING')`,
        [id, status, error],
      );
      await connection.query(
        `UPDATE sync_runs
         SET status = $2,
             failed = CASE WHEN $2 = 'FAILED' THEN total ELSE 0 END,
             started_at = NULL,
             finished_at = CASE WHEN $2 = 'FAILED' THEN NOW() ELSE NULL END,
             last_error = $3
         WHERE id = $1`,
        [id, status, error],
      );
      await connection.query('COMMIT');
      return status;
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async processOfflineSync(id: string) {
    return this.processSync(id, new OfflineInvoiceProvider());
  }

  async processSync(id: string, provider: InvoiceSyncProvider) {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const run = await connection.query(
        'SELECT id FROM sync_runs WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!run.rows[0]) {
        await connection.query('ROLLBACK');
        return undefined;
      }

      await connection.query(
        `UPDATE sync_runs
         SET status = 'PROCESSING',
             attempts = CASE WHEN status = 'PROCESSING' THEN attempts ELSE attempts + 1 END,
             started_at = COALESCE(started_at, NOW()),
             finished_at = NULL,
             last_error = NULL
         WHERE id = $1`,
        [id],
      );
      const items = await connection.query(
        `SELECT id, client_id, account, competence FROM sync_items
         WHERE sync_id = $1 AND status = 'PENDING' ORDER BY id FOR UPDATE`,
        [id],
      );

      for (const item of items.rows) {
        const providerFile = await provider.downloadInvoice({
          clientId: Number(item.client_id),
          account: String(item.account),
          competence: String(item.competence),
        });
        const content = providerFile.content;
        const saved = await this.storage.save(
          Number(item.client_id),
          String(item.account),
          String(item.competence),
          content,
        );
        const sha256 = createHash('sha256').update(content).digest('hex');

        await connection.query(
          `INSERT INTO invoices
             (client_id, account, competence, file_path, sha256, status)
           VALUES ($1,$2,$3,$4,$5,'DOWNLOADED')
           ON CONFLICT (account, competence) DO UPDATE SET
             client_id = EXCLUDED.client_id,
             file_path = EXCLUDED.file_path,
             sha256 = EXCLUDED.sha256,
             status = EXCLUDED.status,
             last_error = NULL,
             downloaded_at = NOW()`,
          [
            item.client_id,
            item.account,
            item.competence,
            saved.filePath,
            sha256,
          ],
        );
        await connection.query(
          `UPDATE sync_items SET status = 'COMPLETED', error = NULL WHERE id = $1`,
          [item.id],
        );
      }

      const totals = await connection.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'COMPLETED')::integer AS completed,
           COUNT(*) FILTER (WHERE status = 'FAILED')::integer AS failed
         FROM sync_items WHERE sync_id = $1`,
        [id],
      );
      const completed = totals.rows[0]?.completed ?? 0;
      const failed = totals.rows[0]?.failed ?? 0;
      const status = failed > 0 ? 'FAILED' : 'COMPLETED';
      await connection.query(
        `UPDATE sync_runs
         SET status = $2,
             completed = $3,
             failed = $4,
             finished_at = NOW(),
             last_error = NULL
         WHERE id = $1`,
        [id, status, completed, failed],
      );
      await connection.query('COMMIT');

      return { syncId: id, status, completed, failed };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSync(id: string, clientId: number) {
    const run = await this.pool.query(
      `SELECT id,status,total,completed,failed,created_at,finished_at
       FROM sync_runs WHERE id=$1 AND client_id=$2`,
      [id, clientId],
    );
    if (!run.rows[0]) return undefined;
    const items = await this.pool.query(
      `SELECT account,competence,status,error
       FROM sync_items WHERE sync_id=$1 ORDER BY id`,
      [id],
    );
    return { ...run.rows[0], items: items.rows };
  }

  async listInvoices(clientId?: number) {
    const query = clientId
      ? await this.pool.query(
          `SELECT id,client_id,account,competence,status,sha256,downloaded_at,sent_at,last_error
           FROM invoices WHERE client_id=$1 ORDER BY downloaded_at DESC`,
          [clientId],
        )
      : await this.pool.query(
          `SELECT id,client_id,account,competence,status,sha256,downloaded_at,sent_at,last_error
           FROM invoices ORDER BY downloaded_at DESC`,
        );
    return query.rows;
  }

  async getInvoiceDownload(invoiceId: number, clientId: number) {
    const invoice = await this.pool.query<{ file_path: string }>(
      `SELECT file_path FROM invoices WHERE id = $1 AND client_id = $2`,
      [invoiceId, clientId],
    );
    const filePath = invoice.rows[0]?.file_path;
    if (!filePath) return undefined;
    return this.storage.read(filePath);
  }
}
