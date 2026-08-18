import 'reflect-metadata';

import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { loadPocConfig, PocConfigurationError } from '../config/poc-config';
import { PocModule } from '../poc.module';
import { EquatorialApiService } from '../providers/equatorial/equatorial-api.service';
import { EquatorialAuthService } from '../providers/equatorial/equatorial-auth.service';
import type { ActiveEquatorialAuthSession } from '../providers/equatorial/equatorial.types';
import { EquatorialError } from '../providers/equatorial/equatorial.errors';
import { EquatorialPdfService } from '../providers/equatorial/equatorial-pdf.service';
import { PocLogger } from '../shared/logging/poc-logger';
import { PostgresInvoiceRepository } from '../persistence/postgres-invoice.repository';
import { processEquatorialPocBatch } from './equatorial-poc-batch';

async function run(): Promise<void> {
  const config = loadPocConfig();
  const app = await NestFactory.createApplicationContext(PocModule, {
    logger: false,
  });
  const logger = app.get(PocLogger);
  let session: ActiveEquatorialAuthSession | undefined;
  const repository = config.databaseUrl
    ? new PostgresInvoiceRepository(config.databaseUrl)
    : undefined;

  try {
    const auth = app.get(EquatorialAuthService);
    const api = app.get(EquatorialApiService);
    const pdfService = app.get(EquatorialPdfService);
    await repository?.initialize();

    logger.info('equatorial.poc.started', {
      portalUrl: config.portalUrl,
      accounts: config.accounts.length,
      competences: config.competences,
      totalItems: config.accounts.length * config.competences.length,
    });

    session = await auth.authenticate(
      {
        document: config.document,
        birthDate: config.birthDate,
      },
      {
        portalUrl: config.portalUrl,
        apiUrl: config.apiUrl,
        headless: config.headless,
        timeoutMs: config.browserTimeoutMs,
        browserChannel: config.browserChannel,
        persistentContext: config.persistentBrowserContext,
        userDataDirectory: config.browserUserDataDirectory,
        diagnosticDirectory: join(config.outputDirectory, 'debug'),
        onOtpRequired: () => {
          logger.info('equatorial.auth.otp_required', {
            message:
              'Conclua o OTP no navegador aberto; a POC continuará automaticamente após o login.',
          });
        },
        onStage: (stage) => {
          logger.info('equatorial.auth.stage', { stage });
        },
        onWaitingForForm: (elapsedSeconds) => {
          logger.info('equatorial.auth.waiting_for_form', { elapsedSeconds });
        },
        onWaitingForToken: (elapsedSeconds) => {
          logger.info('equatorial.auth.waiting_for_token', { elapsedSeconds });
        },
      },
    );
    logger.info('equatorial.auth.completed', { loginMode: session.loginMode });
    logger.info('equatorial.accounts.available', {
      count: session.availableAccounts.length,
    });

    const result = await processEquatorialPocBatch(
      {
        apiUrl: config.apiUrl,
        apiTimeoutMs: config.apiTimeoutMs,
        outputDirectory: config.outputDirectory,
        accounts: config.accounts,
        competences: config.competences,
      },
      session,
      { api, pdfService, repository, logger },
    );

    logger.info('equatorial.batch.completed', {
      totalAccounts: result.totalAccounts,
      totalCompetences: result.totalCompetences,
      totalItems: result.totalItems,
      downloaded: result.downloaded,
      unavailable: result.unavailable,
      failed: result.failed,
    });
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await session?.close();
    await repository?.close();
    await app.close();
  }
}

void run().catch((error: unknown) => {
  const logger = new PocLogger();

  if (error instanceof PocConfigurationError) {
    logger.error('equatorial.poc.configuration_invalid', {
      invalidVariables: error.invalidVariables,
      message: 'Preencha as variáveis indicadas no arquivo .env local.',
    });
  } else if (error instanceof EquatorialError) {
    logger.error('equatorial.poc.failed', {
      errorCode: error.code,
      retryable: error.retryable,
      message: error.message,
    });
  } else if (error instanceof Error) {
    logger.error('equatorial.poc.failed', {
      errorType: error.name,
      message: 'Ocorreu uma falha inesperada sem detalhes sensíveis.',
    });
  } else {
    logger.error('equatorial.poc.failed', { errorType: 'UnknownError' });
  }

  process.exitCode = 1;
});
