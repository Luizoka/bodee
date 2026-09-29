import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAccounts, parseHolderName, parseInvoices } from '../extension/src/equatorial/client.js';
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
        nomeTitular: 'Ana da Silva',
        endereco: 'Rua Exemplo',
        cidade: 'Belém',
      },
    ])).toEqual([
      {
        id: '000103958237',
        holderName: 'Ana da Silva',
        consumerUnitNumber: '123456789',
        installationNumber: '123456789',
        address: 'Rua Exemplo',
        city: 'Belém',
      },
    ]);
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
      .toBe('BODEE/Ana da Silva/UC 123456789 - Conta 000103958237/2026-09.pdf');
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
    expect(manifest.version).toBe('1.0.1');
    expect(manifest.permissions).toEqual(['scripting', 'downloads', 'storage', 'alarms']);
    expect(manifest.host_permissions).toEqual([
      'https://pa.equatorialenergia.com.br/*',
      'https://api-pa-cliente.equatorialenergia.com.br/*',
    ]);
    expect(manifest.icons).toEqual({
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    });
  });
});
