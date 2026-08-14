import { Pool } from 'pg';

export type InvoiceStatus = 'DOWNLOADED' | 'SENT' | 'SEND_FAILED';

export interface InvoiceRecord {
  account: string;
  competence: string;
  filePath: string;
  sha256: string;
  status: InvoiceStatus;
  error?: string;
}

export class PostgresInvoiceRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 2 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
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
      )
    `);
  }

  async recordDownloaded(record: InvoiceRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO invoices
          (account, competence, file_path, sha256, status, last_error)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (account, competence) DO UPDATE SET
          file_path = EXCLUDED.file_path,
          sha256 = EXCLUDED.sha256,
          status = EXCLUDED.status,
          last_error = EXCLUDED.last_error,
          downloaded_at = NOW()
      `,
      [
        record.account,
        record.competence,
        record.filePath,
        record.sha256,
        record.status,
        record.error ?? null,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
