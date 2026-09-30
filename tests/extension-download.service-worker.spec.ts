import { afterEach, describe, expect, it, vi } from 'vitest';

type ExtensionResponse = { ok: boolean; value?: unknown; error?: string };
type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: ExtensionResponse) => void,
) => boolean;

const validPdf = Buffer.from('%PDF-1.7\n', 'utf8').toString('base64');

async function loadWorker(options: {
  apiResponse?: { status: number; body?: unknown };
  downloadError?: Error;
  portalAccounts?: unknown[];
  portalProfile?: unknown;
} = {}) {
  let listener: MessageListener | undefined;
  let alarmListener: ((alarm: { name: string }) => void) | undefined;
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const downloadsDownload = vi.fn(async () => {
    if (options.downloadError) throw options.downloadError;
    return 1;
  });
  const apiResponse = options.apiResponse ?? { status: 200, body: { data: { base64: validPdf } } };

  Object.assign(globalThis, {
    chrome: {
      runtime: { onMessage: { addListener: (candidate: MessageListener) => { listener = candidate; } } },
      tabs: {
        query: vi.fn(async () => [{ id: 10, url: 'https://pa.equatorialenergia.com.br/siteantigo/' }]),
        create: vi.fn(async () => ({ id: 20 })),
        remove: vi.fn(async () => undefined),
        onUpdated: {
          addListener: (callback: (id: number, change: { status: string }) => void) => queueMicrotask(() => callback(20, { status: 'complete' })),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(async ({ func }: { func: { name: string } }) => {
          if (func.name === 'listAccountsFromPortal') return [{ result: { status: 200, body: options.portalAccounts ?? [] } }];
          if (func.name === 'readPortalProfile') return [{ result: options.portalProfile }];
          if (func.name === 'readAccessTokenForRequest') return [{ result: 'header.payload.signature' }];
          if (func.name === 'requestFromApiContext') return [{ result: apiResponse }];
          return [{ result: undefined }];
        }),
      },
      downloads: { download: downloadsDownload },
      alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: { addListener: (candidate: (alarm: { name: string }) => void) => { alarmListener = candidate; } } },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: session[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(session, values); }),
        },
        local: {
          get: vi.fn(async (key: string) => ({ [key]: local[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(local, values); }),
          remove: vi.fn(async (key: string) => { delete local[key]; }),
        },
      },
    },
  });

  await import('../extension/src/background/service-worker.js');
  if (!listener) throw new Error('O service worker não registrou o listener de mensagens.');

  return {
    downloadsDownload,
    job() { return session['bode.download-job']; },
    diagnostic() { return local['bode.last-diagnostic']; },
    fireQueue() { alarmListener?.({ name: 'bode.download-queue' }); },
    send(message: unknown) {
      return new Promise<ExtensionResponse>((resolve) => {
        listener?.(message, {}, resolve);
      });
    },
  };
}

afterEach(() => {
  vi.resetModules();
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('download da extensão', () => {
  it('associa a UC mascarada e o titular do perfil à conta-contrato correta', async () => {
    const worker = await loadWorker({
      portalAccounts: [{ numero: '003013204461', numeroInstalacao: '2000613418' }],
      portalProfile: {
        holderName: 'Claudio Moacy de Carvalho Navarro Neto',
        accounts: [{ id: '003013204461', consumerUnitNumber: '3.816.331.013-70', installationNumber: '2000613418' }],
      },
    });

    await expect(worker.send({ type: 'bode.accounts' })).resolves.toEqual({
      ok: true,
      value: [{
        id: '003013204461',
        holderName: 'Claudio Moacy de Carvalho Navarro Neto',
        consumerUnitNumber: '3.816.331.013-70',
        installationNumber: '2000613418',
        address: undefined,
        city: undefined,
      }],
    });
  });

  it('inclui diagnóstico seguro quando a consulta de unidades falha', async () => {
    const worker = await loadWorker({ portalAccounts: [] });
    const executeScript = (globalThis as unknown as { chrome: { scripting: { executeScript: ReturnType<typeof vi.fn> } } }).chrome.scripting.executeScript;
    executeScript.mockImplementationOnce(async ({ func }: { func: { name: string } }) => {
      if (func.name === 'listAccountsFromPortal') return [{ result: {
        status: 404,
        diagnostic: { operation: 'units', status: 404, contentType: 'text/html', response: 'não JSON' },
      } }];
      return [{ result: undefined }];
    });

    await expect(worker.send({ type: 'bode.accounts' })).resolves.toEqual({
      ok: false,
      error: 'Não foi possível consultar as unidades consumidoras. (Diagnóstico BODEE: unidades; HTTP 404 · text/html · não JSON.)',
    });
    expect(worker.diagnostic()).toMatchObject({ operation: 'units', status: 404, contentType: 'text/html' });
  });

  it('baixa o PDF e sanitiza caracteres perigosos do nome do titular', async () => {
    const worker = await loadWorker();
    const response = await worker.send({
      type: 'bode.download', account: '000123', holderName: 'Ana / <Silva>',
      consumerUnitNumber: '1:23', invoiceNumber: 'FAT/1', competence: '2026/09',
    });

    expect(response).toEqual({ ok: true, value: { filename: 'BODEE/Ana _ _Silva_/UC 1_23 - Conta 000123/2026-09.pdf' } });
    expect(worker.downloadsDownload).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'BODEE/Ana _ _Silva_/UC 1_23 - Conta 000123/2026-09.pdf',
    }));
  });

  it('informa sessão expirada quando a Equatorial recusa a segunda via', async () => {
    const worker = await loadWorker({ apiResponse: { status: 401 } });
    const response = await worker.send({
      type: 'bode.download', account: '000123', invoiceNumber: 'FAT-1', competence: '2026/09',
    });

    expect(response).toEqual({ ok: false, error: 'A sessão expirou. Faça login novamente na Equatorial.' });
  });

  it('preserva o erro do Chrome ao salvar o arquivo', async () => {
    const worker = await loadWorker({ downloadError: new Error('Nome de arquivo recusado pelo Chrome.') });
    const response = await worker.send({
      type: 'bode.download', account: '000123', invoiceNumber: 'FAT-1', competence: '2026/09',
    });

    expect(response).toEqual({ ok: false, error: 'Nome de arquivo recusado pelo Chrome.' });
  });

  it('recusa uma resposta que não contém PDF', async () => {
    const worker = await loadWorker({ apiResponse: { status: 200, body: { data: { base64: 'não é PDF' } } } });
    const response = await worker.send({
      type: 'bode.download', account: '000123', invoiceNumber: 'FAT-1', competence: '2026/09',
    });

    expect(response).toEqual({ ok: false, error: 'A Equatorial não retornou um PDF válido.' });
  });

  it('mantém a fila na memória da sessão e atualiza cada item', async () => {
    const worker = await loadWorker();
    const response = await worker.send({
      type: 'bode.download-queue',
      downloads: [
        { account: '000123', invoiceNumber: 'FAT-1', competence: '2026/09' },
        { account: '000123', invoiceNumber: 'FAT-2', competence: '2026/08' },
      ],
    });

    await vi.waitFor(() => expect(worker.job()).toMatchObject({ complete: 2, failed: 0 }));
    await vi.waitFor(() => expect(worker.job()).toMatchObject({ status: 'COMPLETED' }));
  });
});
