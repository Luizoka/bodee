import 'dotenv/config';

import { join, resolve } from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { EquatorialApiService } from '../providers/equatorial/equatorial-api.service';
import { EquatorialPdfService } from '../providers/equatorial/equatorial-pdf.service';
import { selectInvoiceByCompetence } from '../providers/equatorial/equatorial-invoice.service';
import { PocLogger } from '../shared/logging/poc-logger';
import type {
  ActiveEquatorialAuthSession,
  BrowserHttpResponse,
} from '../providers/equatorial/equatorial.types';

const offlineApiUrl = 'https://offline.equatorial.local';
const defaultAccount = '000003462412';
const defaultCompetence = '2026/08';

async function createSamplePdfBase64(): Promise<string> {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  const bytes = await document.save();
  return Buffer.from(bytes).toString('base64');
}

function createOfflineSession(pdfBase64: string): ActiveEquatorialAuthSession {
  const sampleInvoices = [
    {
      numeroFatura: 'OFFLINE-2026-08',
      competencia:
        process.env.EQUATORIAL_COMPETENCE?.trim() || defaultCompetence,
      valor: 'R$ 123,45',
      dataVencimento: '10/09/2026',
    },
    {
      numeroFatura: 'OFFLINE-2026-07',
      competencia: '2026/07',
      valor: 'R$ 118,20',
      dataVencimento: '10/08/2026',
    },
  ];

  return {
    accessToken: 'offline-test-token',
    authenticatedAt: new Date(),
    loginMode: 'birth_date',
    cookieHeader: 'offline-session=true',
    userAgent: 'fatura-sync-offline',
    portalOrigin: offlineApiUrl,
    availableAccounts: [
      process.env.EQUATORIAL_ACCOUNT?.trim() || defaultAccount,
    ],
    linkedAccounts: [],
    requestJsonFromBrowser: async (
      url: string,
    ): Promise<BrowserHttpResponse> => {
      if (url.includes('/api/v1/debitos/')) {
        return {
          status: 200,
          body: { data: { faturas: sampleInvoices } },
        };
      }

      return {
        status: 200,
        body: { data: { base64: pdfBase64 } },
      };
    },
    close: async () => undefined,
  };
}

async function run(): Promise<void> {
  const logger = new PocLogger();
  const account = process.env.EQUATORIAL_ACCOUNT?.trim() || defaultAccount;
  const competence =
    process.env.EQUATORIAL_COMPETENCE?.trim() || defaultCompetence;
  const outputDirectory = resolve(
    process.cwd(),
    process.env.POC_OFFLINE_OUTPUT_DIR?.trim() || 'output/equatorial-offline',
  );
  const originalFetch = globalThis.fetch;

  try {
    const pdfBase64 = await createSamplePdfBase64();
    const session = createOfflineSession(pdfBase64);
    const api = new EquatorialApiService();
    const pdfService = new EquatorialPdfService();

    globalThis.fetch = async (input: URL | RequestInfo): Promise<Response> => {
      const url = String(input);
      const body = url.includes('/segunda-via/')
        ? { data: { base64: pdfBase64 } }
        : {
            data: {
              faturas: [
                {
                  numeroFatura: 'OFFLINE-2026-08',
                  competencia: competence,
                  valor: 'R$ 123,45',
                  dataVencimento: '10/09/2026',
                },
                {
                  numeroFatura: 'OFFLINE-2026-07',
                  competencia: '2026/07',
                  valor: 'R$ 118,20',
                  dataVencimento: '10/08/2026',
                },
              ],
            },
          };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    logger.info('equatorial.offline.started', { account, competence });
    logger.info('equatorial.auth.token_simulated');

    const invoices = await api.listInvoices(
      offlineApiUrl,
      session,
      account,
      5_000,
    );
    logger.info('equatorial.invoices.listed', { count: invoices.length });

    const invoice = selectInvoiceByCompetence(invoices, competence);
    logger.info('equatorial.invoice.found', {
      competence: invoice.competencia,
    });

    const base64 = await api.downloadInvoice(
      offlineApiUrl,
      session,
      account,
      invoice.numeroFatura,
      5_000,
    );
    const pdf = await pdfService.decodeAndValidate(base64);
    const file = await pdfService.saveLocally(
      pdf,
      outputDirectory,
      account,
      competence,
    );

    logger.info('equatorial.offline.completed', {
      file,
      pageCount: pdf.pageCount,
      size: pdf.size,
      sha256: pdf.sha256,
    });
  } catch (error) {
    logger.error('equatorial.offline.failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Falha inesperada.',
    });
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();
