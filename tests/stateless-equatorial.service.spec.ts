import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';

import { ApiModule } from '../src/api/api.module';
import { StatelessEquatorialService } from '../src/api/stateless-equatorial.service';
import type { EquatorialApiService } from '../src/providers/equatorial/equatorial-api.service';
import type { EquatorialPdfService } from '../src/providers/equatorial/equatorial-pdf.service';
import type { ActiveEquatorialAuthSession } from '../src/providers/equatorial/equatorial.types';

describe('StatelessEquatorialService', () => {
  it('recebe os provedores reais quando criado pelo Nest', async () => {
    const app = await NestFactory.createApplicationContext(ApiModule, {
      logger: false,
    });
    try {
      const service = app.get(StatelessEquatorialService);
      expect(Reflect.get(service, 'auth')).toBeDefined();
      expect(Reflect.get(service, 'api')).toBeDefined();
      expect(Reflect.get(service, 'pdfService')).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('baixa várias competências em uma sessão e devolve um ZIP com resumo', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const session: ActiveEquatorialAuthSession = {
      accessToken: 'test-token',
      authenticatedAt: new Date('2026-08-18T00:00:00.000Z'),
      loginMode: 'birth_date',
      cookieHeader: '',
      userAgent: 'test',
      portalOrigin: 'https://portal.example.test',
      availableAccounts: ['000123'],
      linkedAccounts: [],
      requestJsonFromBrowser: vi.fn(),
      close,
    };
    const auth = {
      authenticate: vi.fn().mockResolvedValue(session),
    };
    const api = {
      listInvoices: vi
        .fn()
        .mockResolvedValue([
          { numeroFatura: 'invoice-1', competencia: '2026/08' },
        ]),
      downloadInvoice: vi.fn().mockResolvedValue('pdf-base64'),
    };
    const pdfService = {
      decodeAndValidate: vi.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-test'),
        pageCount: 1,
        size: 9,
        sha256: 'hash',
      }),
    };
    const service = new StatelessEquatorialService(
      auth,
      api as unknown as EquatorialApiService,
      pdfService as unknown as EquatorialPdfService,
    );

    const result = await service.downloadInvoices({
      document: '00000000000',
      birthDate: '01/01/1990',
      accounts: ['000123'],
      competences: ['2026/08', '2026/07'],
    });

    expect(result).toMatchObject({
      downloaded: 1,
      unavailable: 1,
      failed: 0,
    });
    expect(api.listInvoices).toHaveBeenCalledOnce();
    expect(api.downloadInvoice).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    const files = unzipSync(new Uint8Array(result.buffer));
    expect(Object.keys(files).sort()).toEqual([
      '000123/000123_082026.pdf',
      'resultado.json',
    ]);
    const summary = JSON.parse(
      Buffer.from(files['resultado.json'] ?? []).toString('utf8'),
    ) as { downloaded: number; unavailable: number; failed: number };
    expect(summary).toEqual(
      expect.objectContaining({ downloaded: 1, unavailable: 1, failed: 0 }),
    );
  });

  it('sempre encerra a sessão quando o processamento falha', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const session = {
      accessToken: 'test-token',
      authenticatedAt: new Date(),
      loginMode: 'birth_date' as const,
      cookieHeader: '',
      userAgent: 'test',
      portalOrigin: 'https://portal.example.test',
      availableAccounts: [],
      linkedAccounts: [],
      requestJsonFromBrowser: vi.fn(),
      close,
    };
    const auth = { authenticate: vi.fn().mockResolvedValue(session) };
    const api = {
      listInvoices: vi.fn().mockRejectedValue(new Error('provider failed')),
      downloadInvoice: vi.fn(),
    };
    const pdfService = { decodeAndValidate: vi.fn() };
    const service = new StatelessEquatorialService(
      auth,
      api as unknown as EquatorialApiService,
      pdfService as unknown as EquatorialPdfService,
    );

    const result = await service.downloadInvoices({
      document: '00000000000',
      birthDate: '01/01/1990',
      accounts: ['123'],
      competences: ['2026/08'],
    });

    expect(result).toMatchObject({ downloaded: 0, unavailable: 0, failed: 1 });
    expect(close).toHaveBeenCalledOnce();
  });
});
