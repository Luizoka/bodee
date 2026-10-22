import { afterEach, describe, expect, it, vi } from 'vitest';

import { EquatorialApiService } from '../src/providers/equatorial/equatorial-api.service';
import { EquatorialErrorCode } from '../src/providers/equatorial/equatorial.errors';
import type { EquatorialAuthSession } from '../src/providers/equatorial/equatorial.types';

const testSession: EquatorialAuthSession = {
  accessToken: 'jwt-for-test',
  authenticatedAt: new Date('2026-08-14T00:00:00.000Z'),
  loginMode: 'birth_date',
  cookieHeader: 'session=test-cookie',
  userAgent: 'fatura-sync-test',
  portalOrigin: 'https://portal.example.test',
  availableAccounts: [],
  linkedAccounts: [],
};

describe('EquatorialApiService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('valida e retorna as faturas da conta', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            faturas: [
              { numeroFatura: 123, competencia: '2026/08', valor: '10.00', codigoBarras: null },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', request);

    const result = await new EquatorialApiService().listInvoices(
      'https://api.example.test',
      testSession,
      'account-for-test',
      1_000,
    );

    expect(result).toEqual([
      { numeroFatura: '123', competencia: '2026/08', valor: '10.00', codigoBarras: null },
    ]);
    expect(String(request.mock.calls[0]?.[0])).toContain(
      'listarEmAberto=false',
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('classifica HTTP 401 sem expor o token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(
      new EquatorialApiService().listInvoices(
        'https://api.example.test',
        { ...testSession, accessToken: 'secret-jwt' },
        'account-for-test',
        1_000,
      ),
    ).rejects.toMatchObject({
      code: EquatorialErrorCode.API_UNAUTHORIZED,
      message: expect.not.stringContaining('secret-jwt') as string,
    });
  });

  it('reutiliza os cookies de proteção recebidos em um redirecionamento', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              'https://api.example.test/api/v1/debitos/account-for-test?listarEmAberto=false',
            'set-cookie': 'waf_session=approved; Path=/; Secure',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { faturas: [] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', request);

    await expect(
      new EquatorialApiService().listInvoices(
        'https://api.example.test',
        testSession,
        'account-for-test',
        1_000,
      ),
    ).resolves.toEqual([]);

    const calls = request.mock.calls as unknown as Array<
      [unknown, RequestInit]
    >;
    const secondRequestHeaders = new Headers(calls[1]?.[1]?.headers);
    expect(secondRequestHeaders.get('cookie')).toContain('session=test-cookie');
    expect(secondRequestHeaders.get('cookie')).toContain(
      'waf_session=approved',
    );
  });

  it('usa o contexto autenticado do navegador após HTTP 403', async () => {
    const requestJsonFromBrowser = vi.fn().mockResolvedValue({
      status: 200,
      body: { data: { faturas: [] } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );

    await expect(
      new EquatorialApiService().listInvoices(
        'https://api.example.test',
        {
          ...testSession,
          requestJsonFromBrowser,
          close: vi.fn().mockResolvedValue(undefined),
        },
        'account-for-test',
        1_000,
      ),
    ).resolves.toEqual([]);

    expect(requestJsonFromBrowser).toHaveBeenCalledOnce();
  });

  it('recusa respostas fora do contrato esperado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      new EquatorialApiService().listInvoices(
        'https://api.example.test',
        testSession,
        'account-for-test',
        1_000,
      ),
    ).rejects.toMatchObject({
      code: EquatorialErrorCode.API_INVALID_RESPONSE,
    });
  });
});
