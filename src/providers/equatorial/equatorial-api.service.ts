import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { EquatorialError, EquatorialErrorCode } from './equatorial.errors';
import type {
  ActiveEquatorialAuthSession,
  EquatorialAuthSession,
  EquatorialInvoice,
} from './equatorial.types';

const stringValue = z.union([z.string(), z.number()]).transform(String);

const invoiceSchema = z
  .object({
    numeroFatura: stringValue,
    competencia: z.string(),
    valor: stringValue.optional(),
    dataVencimento: z.string().optional(),
    dataPagamento: z.string().nullable().optional(),
    codigoBarras: z.string().nullable().optional(),
    notaFiscal: z.string().optional(),
  })
  .loose();

const invoicesResponseSchema = z.object({
  data: z.object({
    faturas: z.array(invoiceSchema),
  }),
});

const secondCopyResponseSchema = z.object({
  data: z.object({
    base64: z.string().min(1),
  }),
});

function addCookiePair(cookies: Map<string, string>, value: string): void {
  const pair = value.split(';', 1)[0]?.trim();
  if (!pair) return;

  const separator = pair.indexOf('=');
  if (separator < 1) return;

  cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
}

function createCookieJar(cookieHeader: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of cookieHeader.split(';')) addCookiePair(cookies, pair);
  return cookies;
}

function getSetCookies(headers: Headers): string[] {
  const nodeHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };

  return nodeHeaders.getSetCookie?.() ?? [];
}

function buildHeaders(
  session: EquatorialAuthSession,
  cookies: Map<string, string>,
): Headers {
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${session.accessToken}`,
    origin: session.portalOrigin,
    referer: `${session.portalOrigin}/`,
  });

  if (cookies.size > 0) {
    headers.set(
      'cookie',
      [...cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    );
  }
  if (session.userAgent) headers.set('user-agent', session.userAgent);

  return headers;
}

function hasBrowserHttpFallback(
  session: EquatorialAuthSession,
): session is ActiveEquatorialAuthSession {
  return 'requestJsonFromBrowser' in session;
}

function safeBrowserErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return 'sem detalhe técnico disponível';

  return error.message
    .replace(
      /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
      '[TOKEN_REDACTED]',
    )
    .replace(/\b\d{5,}\b/g, '[NUMBER_REDACTED]')
    .slice(0, 240);
}

@Injectable()
export class EquatorialApiService {
  async listInvoices(
    apiUrl: string,
    session: EquatorialAuthSession,
    account: string,
    timeoutMs: number,
  ): Promise<EquatorialInvoice[]> {
    const url = new URL(
      `/api/v1/debitos/${encodeURIComponent(account)}`,
      apiUrl,
    );
    url.searchParams.set('listarEmAberto', 'false');

    const payload = await this.requestJson(url, session, timeoutMs, 'list');
    const parsed = invoicesResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new EquatorialError(
        EquatorialErrorCode.API_INVALID_RESPONSE,
        'A resposta da consulta de faturas possui formato inesperado.',
        true,
      );
    }

    return parsed.data.data.faturas;
  }

  async downloadInvoice(
    apiUrl: string,
    session: EquatorialAuthSession,
    account: string,
    invoiceNumber: string,
    timeoutMs: number,
  ): Promise<string> {
    const url = new URL(
      `/api/v1/faturas/segunda-via/${encodeURIComponent(invoiceNumber)}`,
      apiUrl,
    );
    url.searchParams.set('contaContrato', account);

    const payload = await this.requestJson(url, session, timeoutMs, 'download');
    const parsed = secondCopyResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new EquatorialError(
        EquatorialErrorCode.DOWNLOAD_FAILED,
        'A segunda via não contém um PDF em Base64.',
        true,
      );
    }

    return parsed.data.data.base64;
  }

  private async requestJson(
    url: URL,
    session: EquatorialAuthSession,
    timeoutMs: number,
    operation: 'list' | 'download',
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await this.fetchWithSession(url, session, timeoutMs);
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');

      throw new EquatorialError(
        isTimeout
          ? EquatorialErrorCode.API_TIMEOUT
          : EquatorialErrorCode.API_ERROR,
        isTimeout
          ? 'A API da Equatorial excedeu o tempo limite.'
          : 'Não foi possível acessar a API da Equatorial.',
        true,
        { cause: error },
      );
    }

    if (response.status === 401) {
      throw new EquatorialError(
        EquatorialErrorCode.API_UNAUTHORIZED,
        'A API recusou a sessão de autenticação.',
        true,
      );
    }

    if (response.status === 403 && hasBrowserHttpFallback(session)) {
      let browserResponse;

      try {
        browserResponse = await session.requestJsonFromBrowser(url.toString());
      } catch (error) {
        const browserErrorType =
          error instanceof Error ? error.name : 'UnknownError';
        const browserErrorDetail = safeBrowserErrorDetail(error);

        throw new EquatorialError(
          EquatorialErrorCode.API_ERROR,
          `A API recusou a sessão tanto no cliente HTTP quanto no navegador (${browserErrorType}: ${browserErrorDetail}).`,
          true,
          { cause: error },
        );
      }

      if (browserResponse.status === 401) {
        throw new EquatorialError(
          EquatorialErrorCode.API_UNAUTHORIZED,
          'A API recusou a sessão de autenticação no navegador.',
          true,
        );
      }

      if (browserResponse.status >= 200 && browserResponse.status < 300) {
        return browserResponse.body;
      }

      throw new EquatorialError(
        EquatorialErrorCode.API_BLOCKED,
        `A API bloqueou a requisição autenticada com HTTP ${browserResponse.status}.`,
        false,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      throw new EquatorialError(
        EquatorialErrorCode.API_BLOCKED,
        `A API redirecionou a requisição com HTTP ${response.status}.`,
        false,
      );
    }

    if (response.status >= 500) {
      throw new EquatorialError(
        EquatorialErrorCode.API_SERVER_ERROR,
        'A API da Equatorial está temporariamente indisponível.',
        true,
      );
    }

    if (!response.ok) {
      throw new EquatorialError(
        operation === 'download'
          ? EquatorialErrorCode.DOWNLOAD_FAILED
          : EquatorialErrorCode.API_ERROR,
        `A API recusou a operação com HTTP ${response.status}.`,
        false,
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new EquatorialError(
        EquatorialErrorCode.API_INVALID_RESPONSE,
        'A API não retornou JSON válido.',
        true,
        { cause: error },
      );
    }
  }

  private async fetchWithSession(
    initialUrl: URL,
    session: EquatorialAuthSession,
    timeoutMs: number,
  ): Promise<Response> {
    const cookies = createCookieJar(session.cookieHeader);
    let url = initialUrl;
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        headers: buildHeaders(session, cookies),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastResponse = response;

      if (response.status < 300 || response.status >= 400) return response;

      const setCookies = getSetCookies(response.headers);
      const location = response.headers.get('location');
      if (setCookies.length === 0 || !location) return response;

      for (const value of setCookies) addCookiePair(cookies, value);
      url = new URL(location, url);
    }

    return lastResponse ?? new Response(null, { status: 599 });
  }
}
