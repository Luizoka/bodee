import { describe, expect, it, vi } from 'vitest';

import { processEquatorialPocBatch } from '../src/cli/equatorial-poc-batch';
import {
  EquatorialError,
  EquatorialErrorCode,
} from '../src/providers/equatorial/equatorial.errors';
import type {
  ActiveEquatorialAuthSession,
  EquatorialInvoice,
  ValidatedPdf,
} from '../src/providers/equatorial/equatorial.types';

function session(availableAccounts: string[]): ActiveEquatorialAuthSession {
  return {
    accessToken: 'test-token',
    authenticatedAt: new Date('2026-08-17T00:00:00Z'),
    loginMode: 'birth_date',
    cookieHeader: '',
    userAgent: 'test',
    portalOrigin: 'https://example.test',
    availableAccounts,
    linkedAccounts: [],
    requestJsonFromBrowser: vi.fn(),
    close: vi.fn(),
  };
}

function invoice(competence: string): EquatorialInvoice {
  return { numeroFatura: `invoice-${competence}`, competencia: competence };
}

const pdf: ValidatedPdf = {
  buffer: Buffer.from('%PDF-test'),
  pageCount: 1,
  size: 9,
  sha256: 'a'.repeat(64),
};

function logger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe('processEquatorialPocBatch', () => {
  it('continua os outros meses e contas após fatura ausente ou download com erro', async () => {
    const api = {
      listInvoices: vi.fn((_url, _session, account: string) =>
        Promise.resolve(
          account === '11111'
            ? [invoice('2026/08'), invoice('2026/07')]
            : [invoice('2026/07')],
        ),
      ),
      downloadInvoice: vi.fn(
        (_url, _session, account: string, invoiceNumber: string) => {
          if (account === '11111' && invoiceNumber.endsWith('2026/08')) {
            return Promise.reject(
              new EquatorialError(
                EquatorialErrorCode.DOWNLOAD_FAILED,
                'Falha de download usada no teste.',
                true,
              ),
            );
          }
          return Promise.resolve('base64');
        },
      ),
    };
    const pdfService = {
      decodeAndValidate: vi.fn(() => Promise.resolve(pdf)),
      saveLocally: vi.fn(
        (_pdf, _directory, account: string, competence: string) =>
          Promise.resolve(`/tmp/${account}-${competence}.pdf`),
      ),
    };
    const repository = {
      recordDownloaded: vi.fn(() => Promise.resolve()),
    };
    const testLogger = logger();

    const result = await processEquatorialPocBatch(
      {
        apiUrl: 'https://api.example.test',
        apiTimeoutMs: 1_000,
        outputDirectory: '/tmp/output',
        accounts: ['11111', '22222'],
        competences: ['2026/08', '2026/07'],
      },
      session(['11111', '22222']),
      { api, pdfService, repository, logger: testLogger },
    );

    expect(result).toMatchObject({
      totalAccounts: 2,
      totalCompetences: 2,
      totalItems: 4,
      downloaded: 2,
      unavailable: 1,
      failed: 1,
    });
    expect(api.listInvoices).toHaveBeenCalledTimes(2);
    expect(api.downloadInvoice).toHaveBeenCalledTimes(3);
    expect(repository.recordDownloaded).toHaveBeenCalledTimes(2);
    expect(testLogger.error).toHaveBeenCalledWith(
      'equatorial.invoice.failed',
      expect.objectContaining({
        contractRef: '*1111',
        competence: '2026/08',
        stage: 'download_invoice',
        errorCode: EquatorialErrorCode.DOWNLOAD_FAILED,
      }),
    );
    expect(testLogger.info).toHaveBeenCalledWith(
      'equatorial.poc.waiting_invoice',
      expect.objectContaining({
        contractRef: '*2222',
        competence: '2026/08',
      }),
    );
  });

  it('pula conta fora da sessão e continua a próxima', async () => {
    const api = {
      listInvoices: vi.fn(() => Promise.resolve([invoice('2026/08')])),
      downloadInvoice: vi.fn(() => Promise.resolve('base64')),
    };
    const pdfService = {
      decodeAndValidate: vi.fn(() => Promise.resolve(pdf)),
      saveLocally: vi.fn(() => Promise.resolve('/tmp/invoice.pdf')),
    };
    const testLogger = logger();

    const result = await processEquatorialPocBatch(
      {
        apiUrl: 'https://api.example.test',
        apiTimeoutMs: 1_000,
        outputDirectory: '/tmp/output',
        accounts: ['11111', '22222'],
        competences: ['2026/08'],
      },
      session(['22222']),
      { api, pdfService, logger: testLogger },
    );

    expect(result).toMatchObject({ downloaded: 1, unavailable: 0, failed: 1 });
    expect(api.listInvoices).toHaveBeenCalledTimes(1);
    expect(testLogger.error).toHaveBeenCalledWith(
      'equatorial.account.skipped',
      expect.objectContaining({ errorCode: 'ACCOUNT_NOT_AVAILABLE' }),
    );
  });

  it('contabiliza falha ao listar uma conta e continua a próxima', async () => {
    const api = {
      listInvoices: vi.fn((_url, _session, account: string) => {
        if (account === '11111') {
          return Promise.reject(
            new EquatorialError(
              EquatorialErrorCode.API_TIMEOUT,
              'Tempo limite usado no teste.',
              true,
            ),
          );
        }
        return Promise.resolve([invoice('2026/08'), invoice('2026/07')]);
      }),
      downloadInvoice: vi.fn(() => Promise.resolve('base64')),
    };
    const pdfService = {
      decodeAndValidate: vi.fn(() => Promise.resolve(pdf)),
      saveLocally: vi.fn(() => Promise.resolve('/tmp/invoice.pdf')),
    };

    const result = await processEquatorialPocBatch(
      {
        apiUrl: 'https://api.example.test',
        apiTimeoutMs: 1_000,
        outputDirectory: '/tmp/output',
        accounts: ['11111', '22222'],
        competences: ['2026/08', '2026/07'],
      },
      session(['11111', '22222']),
      { api, pdfService, logger: logger() },
    );

    expect(result).toMatchObject({ downloaded: 2, unavailable: 0, failed: 2 });
    expect(api.listInvoices).toHaveBeenCalledTimes(2);
    expect(api.downloadInvoice).toHaveBeenCalledTimes(2);
  });

  it.each(['validate_pdf', 'save_pdf', 'record_invoice'] as const)(
    'continua a próxima competência após falha em %s',
    async (failureStage) => {
      const api = {
        listInvoices: vi.fn(() =>
          Promise.resolve([invoice('2026/08'), invoice('2026/07')]),
        ),
        downloadInvoice: vi.fn(
          (_url, _session, _account: string, invoiceNumber: string) =>
            Promise.resolve(invoiceNumber),
        ),
      };
      const pdfService = {
        decodeAndValidate: vi.fn((base64: string) =>
          failureStage === 'validate_pdf' && base64.endsWith('2026/08')
            ? Promise.reject(new Error('Falha de validação usada no teste.'))
            : Promise.resolve(pdf),
        ),
        saveLocally: vi.fn(
          (_pdf, _directory, _account: string, competence: string) =>
            failureStage === 'save_pdf' && competence === '2026/08'
              ? Promise.reject(new Error('Falha de gravação usada no teste.'))
              : Promise.resolve(`/tmp/${competence}.pdf`),
        ),
      };
      const repository = {
        recordDownloaded: vi.fn((record: { competence: string }) =>
          failureStage === 'record_invoice' && record.competence === '2026/08'
            ? Promise.reject(new Error('Falha de banco usada no teste.'))
            : Promise.resolve(),
        ),
      };
      const testLogger = logger();

      const result = await processEquatorialPocBatch(
        {
          apiUrl: 'https://api.example.test',
          apiTimeoutMs: 1_000,
          outputDirectory: '/tmp/output',
          accounts: ['0011111'],
          competences: ['2026/08', '2026/07'],
        },
        session(['11111']),
        { api, pdfService, repository, logger: testLogger },
      );

      expect(result).toMatchObject({
        downloaded: 1,
        unavailable: 0,
        failed: 1,
      });
      expect(api.downloadInvoice).toHaveBeenCalledTimes(2);
      expect(testLogger.error).toHaveBeenCalledWith(
        'equatorial.invoice.failed',
        expect.objectContaining({
          competence: '2026/08',
          stage: failureStage,
        }),
      );
    },
  );
});
