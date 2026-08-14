import 'reflect-metadata';

import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { loadPocConfig, PocConfigurationError } from '../config/poc-config';
import { PocModule } from '../poc.module';
import { EquatorialApiService } from '../providers/equatorial/equatorial-api.service';
import { EquatorialAuthService } from '../providers/equatorial/equatorial-auth.service';
import type {
  ActiveEquatorialAuthSession,
  EquatorialInvoice,
} from '../providers/equatorial/equatorial.types';
import { EquatorialError } from '../providers/equatorial/equatorial.errors';
import {
  listAvailableCompetences,
  selectInvoiceByCompetence,
} from '../providers/equatorial/equatorial-invoice.service';
import { EquatorialPdfService } from '../providers/equatorial/equatorial-pdf.service';
import { PocLogger } from '../shared/logging/poc-logger';

async function run(): Promise<void> {
  const config = loadPocConfig();
  const app = await NestFactory.createApplicationContext(PocModule, {
    logger: false,
  });
  const logger = app.get(PocLogger);
  let session: ActiveEquatorialAuthSession | undefined;

  try {
    const auth = app.get(EquatorialAuthService);
    const api = app.get(EquatorialApiService);
    const pdfService = app.get(EquatorialPdfService);

    logger.info('equatorial.poc.started', {
      portalUrl: config.portalUrl,
      competence: config.competence,
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
      accounts: session.availableAccounts,
      count: session.availableAccounts.length,
    });

    let downloaded = 0;
    let unavailable = 0;
    let failed = 0;

    for (const [accountIndex, account] of config.accounts.entries()) {
      try {
        const invoices = await api.listInvoices(
          config.apiUrl,
          session,
          account,
          config.apiTimeoutMs,
        );
        logger.info('equatorial.invoices.listed', {
          accountIndex: accountIndex + 1,
          count: invoices.length,
        });

        let invoice: EquatorialInvoice;
        try {
          invoice = selectInvoiceByCompetence(invoices, config.competence);
        } catch (error) {
          if (
            error instanceof EquatorialError &&
            error.code === 'INVOICE_NOT_AVAILABLE'
          ) {
            unavailable += 1;
            logger.info('equatorial.poc.waiting_invoice', {
              accountIndex: accountIndex + 1,
              competence: config.competence,
              availableCompetences: listAvailableCompetences(invoices),
            });
            continue;
          }
          throw error;
        }
        logger.info('equatorial.invoice.found', {
          accountIndex: accountIndex + 1,
          competence: invoice.competencia,
        });

        const base64 = await api.downloadInvoice(
          config.apiUrl,
          session,
          account,
          invoice.numeroFatura,
          config.apiTimeoutMs,
        );
        const pdf = await pdfService.decodeAndValidate(base64);
        const file = await pdfService.saveLocally(
          pdf,
          join(config.outputDirectory, account),
          config.competence,
        );

        downloaded += 1;
        logger.info('equatorial.poc.completed', {
          accountIndex: accountIndex + 1,
          file,
          pageCount: pdf.pageCount,
          size: pdf.size,
          sha256: pdf.sha256,
        });
      } catch (error) {
        failed += 1;
        logger.error('equatorial.account.failed', {
          accountIndex: accountIndex + 1,
          errorCode:
            error instanceof EquatorialError ? error.code : 'UNKNOWN_ERROR',
          retryable: error instanceof EquatorialError ? error.retryable : true,
          message:
            error instanceof Error
              ? error.message
              : 'Falha inesperada ao processar a conta.',
        });
      }
    }

    logger.info('equatorial.batch.completed', {
      totalAccounts: config.accounts.length,
      downloaded,
      unavailable,
      failed,
    });
    if (failed > 0) process.exitCode = 1;
  } finally {
    await session?.close();
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
