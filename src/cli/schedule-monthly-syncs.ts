import 'dotenv/config';

import { Pool } from 'pg';

import { ApiService } from '../api/api.service';

function currentCompetence(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.SCHEDULER_TIME_ZONE ?? 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Não foi possível calcular a competência atual.');
  return `${year}/${month}`;
}

function argumentCompetence(): string {
  const equalsArgument = process.argv.find((argument) => argument.startsWith('--competence='));
  if (equalsArgument) return equalsArgument.slice('--competence='.length);
  const index = process.argv.indexOf('--competence');
  return index >= 0 ? (process.argv[index + 1] ?? '') : currentCompetence();
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!databaseUrl || !encryptionKey) {
    throw new Error('DATABASE_URL e CREDENTIALS_ENCRYPTION_KEY são obrigatórias.');
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.');
  }

  const competence = argumentCompetence();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const service = new ApiService(pool, encryptionKey);
    await service.initialize();
    process.stdout.write(`${JSON.stringify({ event: 'scheduler.monthly.started', competence })}\n`);
    const result = await service.scheduleMonthlySyncs(competence);
    process.stdout.write(`${JSON.stringify({ event: 'scheduler.monthly.completed', ...result })}\n`);
  } finally {
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha inesperada.';
  process.stderr.write(`scheduler.monthly.failed: ${message}\n`);
  process.exitCode = 1;
});
