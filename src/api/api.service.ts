import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

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

function encrypt(value: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((part) => part.toString('base64url'))
    .join('.');
}

@Injectable()
export class ApiService {
  constructor(
    private readonly pool: Pool,
    private readonly key: string,
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
        status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
        total INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
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
        `INSERT INTO sync_runs (id,status,total) VALUES ($1,'QUEUED',$2)`,
        [id, items.length],
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

  async processOfflineSync(id: string) {
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
        `UPDATE sync_runs SET status = 'PROCESSING', finished_at = NULL WHERE id = $1`,
        [id],
      );
      const items = await connection.query(
        `SELECT id, client_id, account, competence FROM sync_items
         WHERE sync_id = $1 AND status = 'PENDING' ORDER BY id FOR UPDATE`,
        [id],
      );

      for (const item of items.rows) {
        const sha256 = createHash('sha256')
          .update(`offline:${item.client_id}:${item.account}:${item.competence}`)
          .digest('hex');
        const filePath = `offline://${item.account}/${String(item.competence).replace('/', '-')}.pdf`;

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
            filePath,
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
         SET status = $2, completed = $3, failed = $4, finished_at = NOW()
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

  async getSync(id: string) {
    const run = await this.pool.query(
      `SELECT id,status,total,completed,failed,created_at,finished_at
       FROM sync_runs WHERE id=$1`,
      [id],
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
}
