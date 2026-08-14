import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import {
  chromium,
  type BrowserContext,
  type Page,
  type Response,
} from 'playwright';

import { EquatorialError, EquatorialErrorCode } from './equatorial.errors';
import type {
  ActiveEquatorialAuthSession,
  EquatorialAuthOptions,
  EquatorialCredentials,
  EquatorialLoginMode,
} from './equatorial.types';

const documentSelector = '#identificador';
const birthDateSelector = '#senha-identificador';
const submitSelector = '#envia-identificador';
const otpDocumentSelector = '#identificador-otp';
const otpSubmitSelector = '#envia-identificador-otp';

export function isLikelyJwt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 40 &&
    value.split('.').length === 3
  );
}

export function findAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findAccessToken(item);
      if (token) return token;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['access_token', 'accessToken', 'jwt']) {
    if (isLikelyJwt(record[key])) return record[key];
  }

  for (const nested of Object.values(record)) {
    const token = findAccessToken(nested);
    if (token) return token;
  }

  return undefined;
}

async function readTokenFromResponse(
  response: Response,
): Promise<string | undefined> {
  const contentType = response.headers()['content-type'] ?? '';
  if (!contentType.includes('json')) return undefined;

  try {
    return findAccessToken(await response.json());
  } catch {
    return undefined;
  }
}

async function readTokenFromStorage(page: Page): Promise<string | undefined> {
  const values = await page.evaluate(() => {
    const keys = ['jwt', 'access_token', 'accessToken'];
    return keys.flatMap((key) => [
      window.localStorage.getItem(key),
      window.sessionStorage.getItem(key),
    ]);
  });

  return values.find(isLikelyJwt);
}

export function resolveLoginMode(formState: {
  birthDateVisible: boolean;
  otpVisible: boolean;
}): EquatorialLoginMode | undefined {
  if (formState.birthDateVisible) return 'birth_date';
  if (formState.otpVisible) return 'otp';
  return undefined;
}

async function waitForLoginMode(
  page: Page,
  timeoutMs: number,
  onWaitingForForm?: (elapsedSeconds: number) => void,
): Promise<EquatorialLoginMode | undefined> {
  const startedWaitingAt = Date.now();
  const deadline = startedWaitingAt + Math.min(timeoutMs, 30_000);
  let nextProgressAt = startedWaitingAt + 5_000;
  while (Date.now() < deadline) {
    if (Date.now() >= nextProgressAt) {
      onWaitingForForm?.(Math.floor((Date.now() - startedWaitingAt) / 1_000));
      nextProgressAt += 5_000;
    }

    const loginMode = resolveLoginMode({
      birthDateVisible:
        (await page.locator(documentSelector).isVisible()) &&
        (await page.locator(birthDateSelector).isVisible()) &&
        (await page.locator(submitSelector).isVisible()),
      otpVisible:
        (await page.locator(otpDocumentSelector).isVisible()) &&
        (await page.locator(otpSubmitSelector).isVisible()),
    });

    if (loginMode === 'birth_date') return loginMode;
    if (loginMode === 'otp') return loginMode;

    await page.waitForTimeout(250);
  }

  return undefined;
}

async function waitForBirthDateForm(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const visible =
      (await page.locator(documentSelector).isVisible()) &&
      (await page.locator(birthDateSelector).isVisible()) &&
      (await page.locator(submitSelector).isVisible());

    if (visible) return true;
    await page.waitForTimeout(250);
  }

  return false;
}

async function buildCookieHeader(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();

  return cookies
    .filter((cookie) => cookie.domain.endsWith('equatorialenergia.com.br'))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function prepareApiCookieContext(
  context: BrowserContext,
  apiUrl: string,
  timeoutMs: number,
): Promise<Page> {
  const apiPage = await context.newPage();

  await apiPage
    .goto(new URL(apiUrl).origin, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(timeoutMs, 10_000),
    })
    .catch(() => undefined);
  await apiPage.waitForTimeout(1_000);

  return apiPage;
}

async function captureAuthFormDiagnostic(
  page: Page,
  directory: string,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'auth-form-unavailable.png');
  await page.screenshot({ path: file });
  return file;
}

@Injectable()
export class EquatorialAuthService {
  async authenticate(
    credentials: EquatorialCredentials,
    options: EquatorialAuthOptions,
  ): Promise<ActiveEquatorialAuthSession> {
    const launchOptions = {
      headless: options.headless,
      ...(options.browserChannel === 'chrome'
        ? { channel: 'chrome' as const }
        : {}),
    };
    let context: BrowserContext;
    let closeResource: () => Promise<void>;

    if (options.persistentContext) {
      context = await chromium.launchPersistentContext(
        options.userDataDirectory,
        launchOptions,
      );
      closeResource = async () => context.close();
    } else {
      const browser = await chromium.launch(launchOptions);
      context = await browser.newContext();
      closeResource = async () => browser.close();
    }
    let closeContext = true;

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeoutMs);

      let tokenFromNetwork: string | undefined;
      let networkTokenDetectedAt: number | undefined;
      page.on('response', (response) => {
        void readTokenFromResponse(response).then((token) => {
          if (token) {
            tokenFromNetwork = token;
            networkTokenDetectedAt = Date.now();
          }
        });
      });

      try {
        const response = await page.goto(options.portalUrl, {
          waitUntil: 'domcontentloaded',
          timeout: options.timeoutMs,
        });

        if (response && [401, 403, 429].includes(response.status())) {
          throw new EquatorialError(
            EquatorialErrorCode.PORTAL_BLOCKED,
            `O portal bloqueou a navegação com HTTP ${response.status()}.`,
            false,
          );
        }
      } catch (error) {
        if (error instanceof EquatorialError) throw error;

        throw new EquatorialError(
          EquatorialErrorCode.PORTAL_UNAVAILABLE,
          'Não foi possível abrir o portal da Equatorial.',
          true,
          { cause: error },
        );
      }

      options.onStage?.('portal_loaded');
      const userAgent = await page.evaluate(() => navigator.userAgent);

      let loginMode = await waitForLoginMode(
        page,
        options.timeoutMs,
        options.onWaitingForForm,
      );

      if (!loginMode) {
        const diagnosticFile = await captureAuthFormDiagnostic(
          page,
          options.diagnosticDirectory,
        ).catch(() => undefined);

        throw new EquatorialError(
          EquatorialErrorCode.AUTH_FORM_UNAVAILABLE,
          diagnosticFile
            ? `Nenhum formulário de autenticação compatível apareceu dentro do tempo de espera. Captura salva em ${diagnosticFile}.`
            : 'Nenhum formulário de autenticação compatível apareceu dentro do tempo de espera.',
          false,
        );
      }
      options.onStage?.('form_ready');

      try {
        if (loginMode === 'birth_date') {
          await page.locator(documentSelector).fill(credentials.document);
          await page.locator(birthDateSelector).fill(credentials.birthDate);
          await page.locator(submitSelector).click();
        } else {
          await page.locator(otpDocumentSelector).fill(credentials.document);
          await page.locator(otpSubmitSelector).click();

          // Em algumas sessões o portal começa no formulário curto e só revela
          // CPF + data de nascimento após receber o identificador.
          if (await waitForBirthDateForm(page, 5_000)) {
            await page.locator(birthDateSelector).fill(credentials.birthDate);
            await page.locator(submitSelector).click();
            loginMode = 'birth_date';
          } else {
            options.onOtpRequired?.();
          }
        }
      } catch (error) {
        throw new EquatorialError(
          EquatorialErrorCode.AUTH_FORM_UNAVAILABLE,
          'O formulário de autenticação não ficou pronto para interação.',
          true,
          { cause: error },
        );
      }
      options.onStage?.('login_submitted');

      const startedWaitingAt = Date.now();
      const deadline = Date.now() + options.timeoutMs;
      let nextProgressAt = startedWaitingAt + 5_000;
      while (Date.now() < deadline) {
        if (Date.now() >= nextProgressAt) {
          options.onWaitingForToken?.(
            Math.floor((Date.now() - startedWaitingAt) / 1_000),
          );
          nextProgressAt += 5_000;
        }

        let tokenFromStorage: string | undefined;
        try {
          tokenFromStorage = await readTokenFromStorage(page);
        } catch {
          // O portal pode navegar após a confirmação do OTP; a próxima iteração
          // volta a verificar o armazenamento da página recém-carregada.
        }

        const canUseNetworkToken =
          tokenFromNetwork &&
          networkTokenDetectedAt &&
          Date.now() - networkTokenDetectedAt >= 2_000;
        const token =
          tokenFromStorage ??
          (canUseNetworkToken ? tokenFromNetwork : undefined);
        if (token) {
          options.onStage?.('token_captured');
          await page.waitForTimeout(1_000);
          await page
            .waitForLoadState('domcontentloaded', { timeout: 5_000 })
            .catch(() => undefined);
          let apiPage: Page;
          try {
            apiPage = await prepareApiCookieContext(
              context,
              options.apiUrl,
              options.timeoutMs,
            );
          } catch (error) {
            throw new EquatorialError(
              EquatorialErrorCode.API_ERROR,
              'Não foi possível preparar a sessão para a API da Equatorial.',
              true,
              { cause: error },
            );
          }
          options.onStage?.('api_context_ready');

          let closed = false;
          closeContext = false;

          options.onStage?.('session_ready');

          return {
            accessToken: token,
            authenticatedAt: new Date(),
            loginMode,
            cookieHeader: await buildCookieHeader(context),
            userAgent,
            portalOrigin: new URL(options.portalUrl).origin,
            requestJsonFromBrowser: async (url: string) => {
              // A API está em um subdomínio diferente do portal. A execução
              // nesta aba, já aberta na origem da API, evita o bloqueio CORS
              // que ocorreria se o fetch partisse da página de login.
              await apiPage
                .waitForLoadState('domcontentloaded', { timeout: 5_000 })
                .catch(() => undefined);

              return apiPage.evaluate(
                async ({ requestUrl, accessToken }) => {
                  const response = await fetch(requestUrl, {
                    headers: {
                      accept: 'application/json',
                      authorization: `Bearer ${accessToken}`,
                    },
                    credentials: 'include',
                  });

                  const text = await response.text();
                  let body: unknown = null;
                  if (text) {
                    try {
                      body = JSON.parse(text) as unknown;
                    } catch {
                      body = null;
                    }
                  }

                  return { status: response.status, body };
                },
                { requestUrl: url, accessToken: token },
              );
            },
            close: async () => {
              if (closed) return;
              closed = true;
              await closeResource();
            },
          };
        }

        await page.waitForTimeout(250);
      }

      throw new EquatorialError(
        loginMode === 'otp'
          ? EquatorialErrorCode.AUTH_TIMEOUT
          : EquatorialErrorCode.TOKEN_NOT_FOUND,
        loginMode === 'otp'
          ? 'O OTP não foi concluído dentro do tempo configurado.'
          : 'O login foi enviado, mas nenhum JWT foi encontrado.',
        true,
      );
    } finally {
      if (closeContext) await closeResource();
    }
  }
}
