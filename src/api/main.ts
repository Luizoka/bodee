import 'dotenv/config';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { ApiModule } from './api.module';
import { ApiService } from './api.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!databaseUrl || !encryptionKey || !adminApiKey) {
    throw new Error(
      'DATABASE_URL, CREDENTIALS_ENCRYPTION_KEY e ADMIN_API_KEY são obrigatórias.',
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.',
    );
  }
  if (adminApiKey.length < 32) {
    throw new Error('ADMIN_API_KEY deve ter ao menos 32 caracteres.');
  }

  const app = await NestFactory.create(ApiModule);
  app.setGlobalPrefix('api/v1');
  const pool = app.get(Pool);
  await new ApiService(pool, encryptionKey).initialize();
  await app.listen(Number(process.env.API_PORT ?? 3000), '0.0.0.0');
}

void main();
