import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAccounts, parseHolderName, parseInvoices, readPortalProfile } from '../extension/src/equatorial/client.js';
import { downloadFilename } from '../extension/src/shared/download-path.js';
import { assertEquatorialSuccess } from '../extension/src/shared/equatorial-errors.js';

type ExtensionManifest = {
  manifest_version: number;
  version: string;
  permissions: string[];
  host_permissions: string[];
  icons: Record<string, string>;
};

const parseAccountList = parseAccounts as (value: unknown) => unknown;
const parseAuthenticationHolder = parseHolderName as (value: unknown) => string | undefined;
const parseInvoiceList = parseInvoices as (value: unknown) => unknown;
const readCurrentPortalProfile = readPortalProfile as () => {
  holderName?: string;
  accounts: Array<{ id: string; consumerUnitNumber?: string; installationNumber?: string }>;
};
const createDownloadFilename = downloadFilename as (
  holder: string | undefined,
  unit: string | undefined,
  account: string,
  competence: string,
) => string;
const validateStatus = assertEquatorialSuccess as (status: number, fallback: string) => void;
function parseManifest(value: string): ExtensionManifest { return JSON.parse(value) as ExtensionManifest; }

describe('cliente da extensão BODEE', () => {
  it('monta o titular a partir da resposta de autenticação', () => {
    expect(parseAuthenticationHolder({
      dados_complementares: { nome: 'C***DA', sobrenome: 'C***O' },
    })).toBe('C***DA C***O');
  });

  it('normaliza unidades e preserva titular, UC e conta-contrato', () => {
    expect(parseAccountList([
      {
        numero: '000103958237',
        numeroInstalacao: '123456789',
        ucMascarada: '1.234.567.890-12',
        nomeTitular: 'Ana da Silva',
        endereco: 'Rua Exemplo',
        cidade: 'Belém',
      },
    ])).toEqual([
      {
        id: '000103958237',
        holderName: 'Ana da Silva',
        consumerUnitNumber: '1.234.567.890-12',
        installationNumber: '123456789',
        address: 'Rua Exemplo',
        city: 'Belém',
      },
    ]);
  });

  it('aceita o formato em maiúsculas gravado pelo cache do portal', () => {
    expect(parseAccountList([{ Numero: '000103958237', NumeroInstalacao: '123456789', UcMascarada: '1.234.567.890-12' }]))
      .toEqual([{
        id: '000103958237', holderName: undefined, consumerUnitNumber: '1.234.567.890-12',
        installationNumber: '123456789', address: undefined, city: undefined,
      }]);
  });

  it('combina nome e sobrenome retornados separadamente pela Equatorial', () => {
    expect(parseAccountList([{ numero: '003040325556', nome: 'ZELINDA', sobrenome: 'COSTA DOS REIS' }]))
      .toEqual([{
        id: '003040325556', holderName: 'ZELINDA COSTA DOS REIS', consumerUnitNumber: undefined,
        installationNumber: undefined, address: undefined, city: undefined,
      }]);
  });

  it('não deixa o primeiro nome sobrescrever um nomeTitular completo', () => {
    expect(parseAccountList([{
      numero: '003040325556', nome: 'ZELINDA', nomeTitular: 'ZELINDA COSTA DOS REIS',
    }])).toEqual([expect.objectContaining({ holderName: 'ZELINDA COSTA DOS REIS' })]);
  });

  it('aceita Nome e Sobrenome e não duplica um sobrenome já presente', () => {
    expect(parseAccountList([{
      Numero: '003040325556', Nome: 'ZELINDA COSTA DOS REIS', Sobrenome: 'COSTA DOS REIS',
    }])).toEqual([expect.objectContaining({ holderName: 'ZELINDA COSTA DOS REIS' })]);
  });

  it('usa os dados já presentes na sessão para associar a UC correta à CC', () => {
    const tokenPayload = Buffer.from(JSON.stringify({
      userData: {
        Nome: 'Claudio Moacy de',
        Sobrenome: 'Carvalho Navarro Neto',
        ContasContrato: [{ Numero: '003013204461', UcMascarada: '3.816.331.013-70', NumeroInstalacao: '2000613418' }],
      },
    })).toString('base64url');
    const storage = new Map([['jwt', `header.${tokenPayload}.signature`]]);
    Object.assign(globalThis, {
      window: {
        localStorage: { getItem: (key: string) => storage.get(key) ?? null },
        sessionStorage: { getItem: () => null },
      },
    });

    expect(readCurrentPortalProfile()).toEqual({
      holderName: 'Claudio Moacy de Carvalho Navarro Neto',
      accounts: [{ id: '003013204461', consumerUnitNumber: '3.816.331.013-70', installationNumber: '2000613418' }],
    });
    delete (globalThis as { window?: unknown }).window;
  });

  it('prefere o nome capturado na autenticação atual a dados complementares antigos', () => {
    const sessionValues = new Map([
      ['bode.equatorial.holder-name', 'ZELINDA COSTA DOS REIS'],
      ['dados_complementares', JSON.stringify({ nome: 'LOGIN', sobrenome: 'ANTIGO' })],
    ]);
    Object.assign(globalThis, {
      window: {
        localStorage: { getItem: () => null },
        sessionStorage: {
          getItem: (key: string) => sessionValues.get(key) ?? null,
          get length() { return sessionValues.size; },
          key: (index: number) => [...sessionValues.keys()][index] ?? null,
        },
      },
    });

    expect(readCurrentPortalProfile().holderName).toBe('ZELINDA COSTA DOS REIS');
    delete (globalThis as { window?: unknown }).window;
  });

  it('preserva o sobrenome capturado quando o JWT contém apenas o primeiro nome', () => {
    const tokenPayload = Buffer.from(JSON.stringify({ userData: { Nome: 'ZELINDA' } })).toString('base64url');
    Object.assign(globalThis, {
      window: {
        localStorage: { getItem: (key: string) => key === 'jwt' ? `header.${tokenPayload}.signature` : null },
        sessionStorage: {
          getItem: (key: string) => key === 'bode.equatorial.holder-name' ? 'ZELINDA COSTA DOS REIS' : null,
          length: 0,
          key: () => null,
        },
      },
    });

    expect(readCurrentPortalProfile().holderName).toBe('ZELINDA COSTA DOS REIS');
    delete (globalThis as { window?: unknown }).window;
  });

  it('mantém apenas faturas com número e competência válidos', () => {
    expect(parseInvoiceList({
      data: {
        faturas: [
          { numeroFatura: 123, competencia: '2026/09' },
          { numeroFatura: '', competencia: '2026/08' },
          { numeroFatura: 456, competencia: null },
        ],
      },
    })).toEqual([{ invoiceNumber: '123', competence: '2026/09' }]);
  });

  it('gera um caminho de download seguro e identificável', () => {
    expect(createDownloadFilename('Ana da Silva', '123456789', '000103958237', '2026/09'))
      .toBe('BODEE/Ana da Silva/UC 123456789 - CC 000103958237/2026-09 - 123456789.pdf');
  });

  it('mantém fallbacks seguros quando titular e UC não são informados', () => {
    expect(createDownloadFilename(undefined, undefined, '000103958237', '2026/09'))
      .toBe('BODEE/Titular não informado/CC 000103958237/2026-09.pdf');
  });

  it('traduz sessões expiradas e recusas do portal em mensagens amigáveis', () => {
    expect(() => validateStatus(401, 'Falha.')).toThrow('A sessão expirou.');
    expect(() => validateStatus(403, 'Falha.')).toThrow('A Equatorial recusou esta sessão.');
    expect(() => validateStatus(429, 'Falha.')).toThrow('limitou temporariamente');
  });
});

describe('manifesto da extensão', () => {
  it('usa Manifest V3, ícones oficiais e hosts restritos', async () => {
    const manifest = parseManifest(await readFile(join(process.cwd(), 'extension', 'manifest.json'), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('1.0.10');
    expect(manifest.permissions).toEqual(['scripting', 'downloads', 'storage', 'alarms']);
    expect(manifest.host_permissions).toEqual([
      'https://pa.equatorialenergia.com.br/*',
      'https://api-pa-cliente.equatorialenergia.com.br/*',
      'https://pi.equatorialenergia.com.br/*',
      'https://api-pi-cliente.equatorialenergia.com.br/*',
      'https://al.equatorialenergia.com.br/*',
      'https://api-al-cliente.equatorialenergia.com.br/*',
      'https://ap.equatorialenergia.com.br/*',
      'https://api-ap-cliente.equatorialenergia.com.br/*',
      'https://ma.equatorialenergia.com.br/*',
      'https://api-ma-cliente.equatorialenergia.com.br/*',
    ]);
    expect(manifest.icons).toEqual({
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    });
  });
});
