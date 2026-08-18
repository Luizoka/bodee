import 'dotenv/config';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ApiModule } from './api.module';
import { ApiService } from './api.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey) {
    throw new Error('ADMIN_API_KEY é obrigatória.');
  }
  if (databaseUrl && !encryptionKey) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY é obrigatória quando DATABASE_URL estiver configurada.',
    );
  }
  if (databaseUrl && encryptionKey && !/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.',
    );
  }
  if (adminApiKey.length < 32) {
    throw new Error('ADMIN_API_KEY deve ter ao menos 32 caracteres.');
  }

  const app = await NestFactory.create(ApiModule);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  if (databaseUrl) await app.get(ApiService).initialize();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FaturaSync API')
      .setDescription(
        'API para baixar faturas diretamente da Equatorial e, quando houver banco configurado, gerenciar clientes e sincronizações. Use a chave correta no botão Authorize.',
      )
      .setVersion('0.1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'API key' },
        'adminApiKey',
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'API key' },
        'clientApiKey',
      )
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, { useGlobalPrefix: false });
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void main();
