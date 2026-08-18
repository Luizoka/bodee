import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';

import { EquatorialApiService } from '../providers/equatorial/equatorial-api.service';
import { EquatorialAuthService } from '../providers/equatorial/equatorial-auth.service';
import { EquatorialError } from '../providers/equatorial/equatorial.errors';
import { selectInvoiceByCompetence } from '../providers/equatorial/equatorial-invoice.service';
import { EquatorialPdfService } from '../providers/equatorial/equatorial-pdf.service';
import type { ActiveEquatorialAuthSession } from '../providers/equatorial/equatorial.types';

export interface StatelessInvoiceDownloadInput {
  document: string;
  birthDate: string;
  accounts: string[];
  competences: string[];
}

type StatelessInvoiceStatus = 'downloaded' | 'unavailable' | 'failed';

interface StatelessInvoiceResultItem {
  account: string;
  competence: string;
  status: StatelessInvoiceStatus;
  filename?: string;
  errorCode?: string;
  message?: string;
}

export interface StatelessInvoiceArchive {
  buffer: Buffer;
  downloaded: number;
  unavailable: number;
  failed: number;
}

interface StatelessEquatorialOptions {
  portalUrl: string;
  apiUrl: string;
  headless: boolean;
  browserTimeoutMs: number;
  loginMaxAttempts: number;
  apiTimeoutMs: number;
  browserChannel: 'chrome' | 'chromium';
}

const defaultPortalUrl = 'https://pa.equatorialenergia.com.br/siteantigo';
const defaultApiUrl = 'https://api-pa-cliente.equatorialenergia.com.br';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptions(): StatelessEquatorialOptions {
  return {
    portalUrl: process.env.EQUATORIAL_PORTAL_URL ?? defaultPortalUrl,
    apiUrl: process.env.EQUATORIAL_API_URL ?? defaultApiUrl,
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    browserTimeoutMs: positiveInteger(
      process.env.PLAYWRIGHT_TIMEOUT_MS,
      60_000,
    ),
    loginMaxAttempts: positiveInteger(
      process.env.EQUATORIAL_LOGIN_MAX_ATTEMPTS,
      3,
    ),
    apiTimeoutMs: positiveInteger(
      process.env.EQUATORIAL_API_TIMEOUT_MS,
      30_000,
    ),
    browserChannel:
      process.env.PLAYWRIGHT_BROWSER_CHANNEL === 'chrome'
        ? 'chrome'
        : 'chromium',
  };
}

function normalizedAccount(account: string): string {
  return account.replace(/^0+(?=\d)/, '');
}

function invoiceFilename(account: string, competence: string): string {
  const monthYear = competence.replace(/^(\d{4})\/(\d{2})$/, '$2$1');
  return `${account}/${account}_${monthYear}.pdf`;
}

function safeFailure(
  error: unknown,
): Pick<StatelessInvoiceResultItem, 'errorCode' | 'message'> {
  if (error instanceof EquatorialError) {
    return { errorCode: error.code, message: error.message };
  }

  return {
    errorCode: 'UNKNOWN_ERROR',
    message: 'Falha inesperada durante o processamento da fatura.',
  };
}

@Injectable()
export class StatelessEquatorialService {
  constructor(
    @Inject(EquatorialAuthService)
    private readonly auth: EquatorialAuthService,
    @Inject(EquatorialApiService)
    private readonly api: EquatorialApiService,
    @Inject(EquatorialPdfService)
    private readonly pdfService: EquatorialPdfService,
  ) {}

  async downloadInvoices(
    input: StatelessInvoiceDownloadInput,
  ): Promise<StatelessInvoiceArchive> {
    const options = readOptions();
    const accounts = [...new Set(input.accounts)];
    const competences = [...new Set(input.competences)];
    let session: ActiveEquatorialAuthSession | undefined;

    try {
      session = await this.auth.authenticate(
        { document: input.document, birthDate: input.birthDate },
        {
          portalUrl: options.portalUrl,
          apiUrl: options.apiUrl,
          headless: options.headless,
          timeoutMs: options.browserTimeoutMs,
          browserChannel: options.browserChannel,
          persistentContext: false,
          userDataDirectory: join('/tmp', 'fatura-sync-browser'),
          diagnosticDirectory: join('/tmp', 'fatura-sync-debug'),
          maxAttempts: options.loginMaxAttempts,
        },
      );

      return await this.buildArchive(accounts, competences, session, options);
    } finally {
      await session?.close();
    }
  }

  private async buildArchive(
    accounts: string[],
    competences: string[],
    session: ActiveEquatorialAuthSession,
    options: StatelessEquatorialOptions,
  ): Promise<StatelessInvoiceArchive> {
    const archiveFiles: Record<string, Uint8Array> = {};
    const items: StatelessInvoiceResultItem[] = [];
    const availableAccounts = new Set(
      session.availableAccounts.map(normalizedAccount),
    );

    for (const account of accounts) {
      if (
        availableAccounts.size > 0 &&
        !availableAccounts.has(normalizedAccount(account))
      ) {
        for (const competence of competences) {
          items.push({
            account,
            competence,
            status: 'failed',
            errorCode: 'ACCOUNT_NOT_AVAILABLE',
            message: 'A conta informada não pertence à pessoa autenticada.',
          });
        }
        continue;
      }

      let invoices;
      try {
        invoices = await this.api.listInvoices(
          options.apiUrl,
          session,
          account,
          options.apiTimeoutMs,
        );
      } catch (error) {
        const failure = safeFailure(error);
        for (const competence of competences) {
          items.push({
            account,
            competence,
            status: 'failed',
            ...failure,
          });
        }
        continue;
      }

      for (const competence of competences) {
        try {
          const invoice = selectInvoiceByCompetence(invoices, competence);
          const base64 = await this.api.downloadInvoice(
            options.apiUrl,
            session,
            account,
            invoice.numeroFatura,
            options.apiTimeoutMs,
          );
          const pdf = await this.pdfService.decodeAndValidate(base64);
          const filename = invoiceFilename(account, competence);
          archiveFiles[filename] = new Uint8Array(pdf.buffer);
          items.push({
            account,
            competence,
            status: 'downloaded',
            filename,
          });
        } catch (error) {
          if (
            error instanceof EquatorialError &&
            error.code === 'INVOICE_NOT_AVAILABLE'
          ) {
            items.push({ account, competence, status: 'unavailable' });
            continue;
          }

          items.push({
            account,
            competence,
            status: 'failed',
            ...safeFailure(error),
          });
        }
      }
    }

    const downloaded = items.filter(
      (item) => item.status === 'downloaded',
    ).length;
    const unavailable = items.filter(
      (item) => item.status === 'unavailable',
    ).length;
    const failed = items.filter((item) => item.status === 'failed').length;
    archiveFiles['resultado.json'] = strToU8(
      JSON.stringify(
        {
          total: items.length,
          downloaded,
          unavailable,
          failed,
          items,
        },
        null,
        2,
      ),
    );

    return {
      buffer: Buffer.from(zipSync(archiveFiles, { level: 0 })),
      downloaded,
      unavailable,
      failed,
    };
  }
}
