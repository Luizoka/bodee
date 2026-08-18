import { join } from 'node:path';

import type { PostgresInvoiceRepository } from '../persistence/postgres-invoice.repository';
import type { EquatorialApiService } from '../providers/equatorial/equatorial-api.service';
import { EquatorialError } from '../providers/equatorial/equatorial.errors';
import {
  listAvailableCompetences,
  selectInvoiceByCompetence,
} from '../providers/equatorial/equatorial-invoice.service';
import type { EquatorialPdfService } from '../providers/equatorial/equatorial-pdf.service';
import type { ActiveEquatorialAuthSession } from '../providers/equatorial/equatorial.types';
import type { PocLogger } from '../shared/logging/poc-logger';

type ItemStage =
  | 'select_invoice'
  | 'download_invoice'
  | 'validate_pdf'
  | 'save_pdf'
  | 'record_invoice';

export interface EquatorialPocBatchInput {
  apiUrl: string;
  apiTimeoutMs: number;
  outputDirectory: string;
  accounts: string[];
  competences: string[];
}

export interface EquatorialPocAccountResult {
  account: string;
  downloaded: number;
  unavailable: number;
  failed: number;
}

export interface EquatorialPocBatchResult {
  totalAccounts: number;
  totalCompetences: number;
  totalItems: number;
  downloaded: number;
  unavailable: number;
  failed: number;
  accounts: EquatorialPocAccountResult[];
}

interface EquatorialPocBatchDependencies {
  api: Pick<EquatorialApiService, 'listInvoices' | 'downloadInvoice'>;
  pdfService: Pick<EquatorialPdfService, 'decodeAndValidate' | 'saveLocally'>;
  repository?: Pick<PostgresInvoiceRepository, 'recordDownloaded'> | undefined;
  logger: Pick<PocLogger, 'info' | 'error'>;
}

function contractReference(account: string): string {
  if (account.length <= 4) return '*'.repeat(account.length);
  return `${'*'.repeat(account.length - 4)}${account.slice(-4)}`;
}

function normalizedAccount(account: string): string {
  return account.replace(/^0+(?=\d)/, '');
}

function errorMetadata(error: unknown): {
  errorCode: string;
  retryable: boolean;
  message: string;
} {
  if (error instanceof EquatorialError) {
    return {
      errorCode: error.code,
      retryable: error.retryable,
      message: error.message,
    };
  }

  return {
    errorCode: 'UNKNOWN_ERROR',
    retryable: true,
    message: 'Falha inesperada durante o processamento.',
  };
}

export async function processEquatorialPocBatch(
  input: EquatorialPocBatchInput,
  session: ActiveEquatorialAuthSession,
  dependencies: EquatorialPocBatchDependencies,
): Promise<EquatorialPocBatchResult> {
  const accountResults: EquatorialPocAccountResult[] = [];
  const knownSessionAccounts = new Set(
    session.availableAccounts.map(normalizedAccount),
  );

  for (const [accountIndex, account] of input.accounts.entries()) {
    const contractRef = contractReference(account);
    const accountResult: EquatorialPocAccountResult = {
      account,
      downloaded: 0,
      unavailable: 0,
      failed: 0,
    };
    accountResults.push(accountResult);

    dependencies.logger.info('equatorial.account.started', {
      accountIndex: accountIndex + 1,
      contractRef,
      competenceCount: input.competences.length,
    });

    if (
      knownSessionAccounts.size > 0 &&
      !knownSessionAccounts.has(normalizedAccount(account))
    ) {
      accountResult.failed = input.competences.length;
      dependencies.logger.error('equatorial.account.skipped', {
        accountIndex: accountIndex + 1,
        contractRef,
        errorCode: 'ACCOUNT_NOT_AVAILABLE',
        retryable: false,
        affectedCompetences: input.competences.length,
        message: 'A conta configurada não pertence à sessão autenticada.',
      });
      dependencies.logger.info('equatorial.account.completed', {
        accountIndex: accountIndex + 1,
        contractRef,
        downloaded: accountResult.downloaded,
        unavailable: accountResult.unavailable,
        failed: accountResult.failed,
      });
      continue;
    }

    let invoices;
    try {
      invoices = await dependencies.api.listInvoices(
        input.apiUrl,
        session,
        account,
        input.apiTimeoutMs,
      );
      dependencies.logger.info('equatorial.invoices.listed', {
        accountIndex: accountIndex + 1,
        contractRef,
        count: invoices.length,
      });
    } catch (error) {
      accountResult.failed = input.competences.length;
      dependencies.logger.error('equatorial.account.list_failed', {
        accountIndex: accountIndex + 1,
        contractRef,
        affectedCompetences: input.competences.length,
        ...errorMetadata(error),
      });
      dependencies.logger.info('equatorial.account.completed', {
        accountIndex: accountIndex + 1,
        contractRef,
        downloaded: accountResult.downloaded,
        unavailable: accountResult.unavailable,
        failed: accountResult.failed,
      });
      continue;
    }

    for (const [competenceIndex, competence] of input.competences.entries()) {
      let stage: ItemStage = 'select_invoice';

      dependencies.logger.info('equatorial.invoice.started', {
        accountIndex: accountIndex + 1,
        contractRef,
        competenceIndex: competenceIndex + 1,
        competence,
      });

      try {
        let invoice;
        try {
          invoice = selectInvoiceByCompetence(invoices, competence);
        } catch (error) {
          if (
            error instanceof EquatorialError &&
            error.code === 'INVOICE_NOT_AVAILABLE'
          ) {
            accountResult.unavailable += 1;
            dependencies.logger.info('equatorial.poc.waiting_invoice', {
              accountIndex: accountIndex + 1,
              contractRef,
              competence,
              availableCompetences: listAvailableCompetences(invoices),
            });
            continue;
          }
          throw error;
        }

        dependencies.logger.info('equatorial.invoice.found', {
          accountIndex: accountIndex + 1,
          contractRef,
          competence: invoice.competencia,
        });

        stage = 'download_invoice';
        dependencies.logger.info('equatorial.invoice.download_started', {
          accountIndex: accountIndex + 1,
          contractRef,
          competence,
        });
        const base64 = await dependencies.api.downloadInvoice(
          input.apiUrl,
          session,
          account,
          invoice.numeroFatura,
          input.apiTimeoutMs,
        );

        stage = 'validate_pdf';
        const pdf = await dependencies.pdfService.decodeAndValidate(base64);

        stage = 'save_pdf';
        const file = await dependencies.pdfService.saveLocally(
          pdf,
          join(input.outputDirectory, account),
          account,
          competence,
        );

        stage = 'record_invoice';
        await dependencies.repository?.recordDownloaded({
          account,
          competence,
          filePath: file,
          sha256: pdf.sha256,
          status: 'DOWNLOADED',
        });

        accountResult.downloaded += 1;
        dependencies.logger.info('equatorial.invoice.completed', {
          accountIndex: accountIndex + 1,
          contractRef,
          competence,
          file,
          pageCount: pdf.pageCount,
          size: pdf.size,
          sha256: pdf.sha256,
        });
      } catch (error) {
        accountResult.failed += 1;
        dependencies.logger.error('equatorial.invoice.failed', {
          accountIndex: accountIndex + 1,
          contractRef,
          competence,
          stage,
          ...errorMetadata(error),
        });
      }
    }

    dependencies.logger.info('equatorial.account.completed', {
      accountIndex: accountIndex + 1,
      contractRef,
      downloaded: accountResult.downloaded,
      unavailable: accountResult.unavailable,
      failed: accountResult.failed,
    });
  }

  return accountResults.reduce<EquatorialPocBatchResult>(
    (result, account) => {
      result.downloaded += account.downloaded;
      result.unavailable += account.unavailable;
      result.failed += account.failed;
      return result;
    },
    {
      totalAccounts: input.accounts.length,
      totalCompetences: input.competences.length,
      totalItems: input.accounts.length * input.competences.length,
      downloaded: 0,
      unavailable: 0,
      failed: 0,
      accounts: accountResults,
    },
  );
}
