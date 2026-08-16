import 'dotenv/config';

import { Pool } from 'pg';

import { ApiService } from '../api/api.service';

async function run(): Promise<void> {
  const syncId = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!syncId || !databaseUrl || !encryptionKey) {
    throw new Error(
      'Uso: pnpm worker:offline -- <syncId>. DATABASE_URL e CREDENTIALS_ENCRYPTION_KEY são obrigatórias.',
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.',
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const service = new ApiService(pool, encryptionKey);
    await service.initialize();
    const result = await service.processOfflineSync(syncId);
    if (!result) throw new Error('Sincronização não encontrada.');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha inesperada.';
  process.stderr.write(`worker.offline.failed: ${message}\n`);
  process.exitCode = 1;
});
