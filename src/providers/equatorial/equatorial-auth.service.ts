import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from 'playwright';

import { EquatorialError, EquatorialErrorCode } from './equatorial.errors';
import type {
  ActiveEquatorialAuthSession,
  EquatorialAccount,
  EquatorialAuthOptions,
  EquatorialCredentials,
  EquatorialLoginMode,
  EquatorialLoginResult,
  EquatorialNetworkEvent,
} from './equatorial.types';

const documentSelector = '#identificador';
const birthDateSelector = '#senha-identificador';
const submitSelector = '#envia-identificador';
const otpDocumentSelector = '#identificador-otp';
const otpSubmitSelector = '#envia-identificador-otp';
const relevantRequestPattern =
  /\/ajax-requests\/(otp-check|autenticacao|ajax-uc-contas-contrato)\/?$/;
const requiredAuthFields = [
  'grant_type',
  'username',
  'password',
  'actiongr',
  'tokengr',
  'navegador',
  'dispositivo',
  'empresaId',
  'transmit_token',
  'transmit_user',
] as const;
const defaultRetryDelaysMs = [2_000, 5_000];

interface WindowWithSecurityScripts extends Window {
  grecaptcha?: {
    execute?: (...args: unknown[]) => unknown;
    ready?: (callback: () => void) => void;
    enterprise?: {
      execute?: (...args: unknown[]) => unknown;
      ready?: (callback: () => void) => void;
    };
  };
  tsPlatform?: {
    drs?: {
      triggerActionEvent?: (...args: unknown[]) => Promise<unknown>;
    };
  };
  __faturaSyncOriginalXhrSend?: typeof XMLHttpRequest.prototype.send;
}

export function isLikelyJwt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 40 &&
    value.split('.').length === 3
  );
}

export function findAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;

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

function decodeJwtPayload(token: string): unknown {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(
      Buffer.from(normalized, 'base64').toString('utf8'),
    ) as unknown;
  } catch {
    return undefined;
  }
}

export function findContractAccounts(token: string): string[] {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload !== 'object') return [];

  const accounts: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      if (key.toLowerCase() === 'contascontrato' && Array.isArray(nested)) {
        for (const account of nested) {
          if (!account || typeof account !== 'object') continue;
          const record = account as Record<string, unknown>;
          const number =
            record.Numero ??
            record.numero ??
            record.numeroContaContrato ??
            record.contaContrato;
          if (typeof number === 'string' || typeof number === 'number') {
            accounts.push(String(number));
          }
        }
      }
      visit(nested);
    }
  };

  visit(payload);
  return [...new Set(accounts)];
}

export function getPostFieldNames(postData: string | null): string[] {
  if (!postData) return [];

  if (postData.includes('Content-Disposition: form-data')) {
    return [
      ...new Set(
        [
          ...postData.matchAll(
            /Content-Disposition: form-data;\s*name="([^"]+)"/g,
          ),
        ]
          .map((match) => match[1])
          .filter((name): name is string => Boolean(name)),
      ),
    ].sort();
  }

  try {
    const parsed = JSON.parse(postData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.keys(parsed).sort();
    }
  } catch {
    // O formulário real usa application/x-www-form-urlencoded.
  }

  return [...new Set(new URLSearchParams(postData).keys())].sort();
}

export function parseEquatorialAccounts(value: unknown): EquatorialAccount[] {
  if (!Array.isArray(value)) return [];

  const accounts: EquatorialAccount[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = record.numero ?? record.id ?? record.contaContrato ?? record.uc;
    if (typeof id !== 'string' && typeof id !== 'number') continue;

    const optionalString = (candidate: unknown): string | undefined =>
      typeof candidate === 'string' || typeof candidate === 'number'
        ? String(candidate)
        : undefined;

    accounts.push({
      id: String(id),
      installationNumber: optionalString(record.numeroInstalacao),
      maskedConsumerUnit: optionalString(record.ucMascarada),
      address: optionalString(record.endereco),
      neighborhood: optionalString(record.bairro),
      city: optionalString(record.cidade),
    });
  }

  return accounts.filter(
    (account, index) =>
      accounts.findIndex((candidate) => candidate.id === account.id) === index,
  );
}

/**
 * O endpoint de autenticação separa o nome cadastrado em duas partes. Esse é
 * o único ponto confiável do fluxo em que o titular é retornado.
 */
export function findHolderName(authenticationPayload: unknown): string | undefined {
  if (!authenticationPayload || typeof authenticationPayload !== 'object') {
    return undefined;
  }

  const complementaryData = (authenticationPayload as Record<string, unknown>)
    .dados_complementares;
  if (!complementaryData || typeof complementaryData !== 'object') return undefined;

  const { nome, sobrenome } = complementaryData as Record<string, unknown>;
  const parts = [nome, sobrenome]
    .filter((part): part is string | number =>
      typeof part === 'string' || typeof part === 'number',
    )
    .map((part) => String(part).trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function requireEquatorialAccounts(value: unknown): EquatorialAccount[] {
  const accounts = parseEquatorialAccounts(value);
  if (accounts.length === 0) {
    throw new EquatorialError(
      EquatorialErrorCode.ACCOUNT_LIST_FAILED,
      'A sessão foi criada, mas nenhuma unidade consumidora válida foi retornada.',
      true,
    );
  }
  return accounts;
}

export function isLoginDeniedPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return [record.error, record.error_description, record.message].some(
    (candidate) =>
      typeof candidate === 'string' &&
      candidate.trim().toUpperCase() === 'DENY',
  );
}

export function resolveLoginMode(formState: {
  birthDateVisible: boolean;
  otpVisible: boolean;
}): EquatorialLoginMode | undefined {
  if (formState.birthDateVisible) return 'birth_date';
  if (formState.otpVisible) return 'otp';
  return undefined;
}

export async function runControlledAuthAttempts<T>(
  maxAttempts: number,
  retryDelaysMs: number[],
  attempt: (attemptNumber: number) => Promise<T>,
  onRetry?: (attemptNumber: number, delayMs: number) => void,
  wait: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<T> {
  let lastError: unknown;
  const attempts = Math.max(1, Math.min(maxAttempts, 3));

  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
    try {
      return await attempt(attemptNumber);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof EquatorialError ? error.retryable : false;
      if (!retryable || attemptNumber === attempts) throw error;

      const delayMs =
        retryDelaysMs[attemptNumber - 1] ??
        retryDelaysMs.at(-1) ??
        defaultRetryDelaysMs.at(-1) ??
        5_000;
      onRetry?.(attemptNumber, delayMs);
      await wait(delayMs);
    }
  }

  throw lastError;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers()['content-type'] ?? '';
  if (!contentType.includes('json')) return undefined;
  try {
    return (await response.json()) as unknown;
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

async function waitForStoredToken(
  page: Page,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const token = await readTokenFromStorage(page);
      if (token) return token;
    } catch {
      // A navegação pode trocar o execution context por alguns milissegundos.
    }
    await page.waitForTimeout(200);
  }
  return undefined;
}

async function waitForLoginMode(
  page: Page,
  timeoutMs: number,
  onWaitingForForm?: (elapsedSeconds: number) => void,
): Promise<EquatorialLoginMode | undefined> {
  const startedAt = Date.now();
  const deadline = startedAt + Math.min(timeoutMs, 30_000);
  let nextProgressAt = startedAt + 5_000;

  while (Date.now() < deadline) {
    if (Date.now() >= nextProgressAt) {
      onWaitingForForm?.(Math.floor((Date.now() - startedAt) / 1_000));
      nextProgressAt += 5_000;
    }

    const mode = resolveLoginMode({
      birthDateVisible:
        (await page.locator(documentSelector).isVisible()) &&
        (await page.locator(birthDateSelector).isVisible()) &&
        (await page.locator(submitSelector).isVisible()),
      otpVisible:
        (await page.locator(otpDocumentSelector).isVisible()) &&
        (await page.locator(otpSubmitSelector).isVisible()),
    });
    if (mode) return mode;
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
    if (
      (await page.locator(documentSelector).isVisible()) &&
      (await page.locator(birthDateSelector).isVisible()) &&
      (await page.locator(submitSelector).isVisible())
    ) {
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

async function waitForSecurityScripts(
  page: Page,
  timeoutMs: number,
  requireTransmit: boolean,
): Promise<void> {
  try {
    await page.waitForFunction(
      (needsTransmit) => {
        const currentWindow = window as WindowWithSecurityScripts;
        const captcha = currentWindow.grecaptcha;
        const captchaReady = Boolean(
          captcha?.enterprise?.execute ?? captcha?.execute,
        );
        const transmitReady = Boolean(
          currentWindow.tsPlatform?.drs?.triggerActionEvent,
        );
        return captchaReady && (!needsTransmit || transmitReady);
      },
      requireTransmit,
      { timeout: Math.min(timeoutMs, 30_000) },
    );

    await page.evaluate(async () => {
      const captcha = (window as WindowWithSecurityScripts).grecaptcha;
      const ready = captcha?.enterprise?.ready ?? captcha?.ready;
      if (!ready) return;
      await new Promise<void>((resolve) => ready(resolve));
    });
  } catch (error) {
    throw new EquatorialError(
      EquatorialErrorCode.SCRIPT_LOAD_FAILED,
      'Os scripts de segurança necessários para o login não ficaram prontos.',
      true,
      { cause: error },
    );
  }
}

async function waitForTransmitInterceptor(
  page: Page,
  timeoutMs: number,
): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const currentWindow = window as WindowWithSecurityScripts;
        return Boolean(
          currentWindow.__faturaSyncOriginalXhrSend &&
          XMLHttpRequest.prototype.send !==
            currentWindow.__faturaSyncOriginalXhrSend,
        );
      },
      undefined,
      { timeout: Math.min(timeoutMs, 15_000) },
    );
  } catch (error) {
    throw new EquatorialError(
      EquatorialErrorCode.SCRIPT_LOAD_FAILED,
      'O mecanismo de segurança do portal não concluiu a inicialização.',
      true,
      { cause: error },
    );
  }
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
  filename: string,
): Promise<string> {
  await page
    .locator(
      [
        documentSelector,
        birthDateSelector,
        otpDocumentSelector,
        'input[name="username"]',
        'input[name="password"]',
      ].join(','),
    )
    .evaluateAll((inputs) => {
      for (const input of inputs) {
        if (input instanceof HTMLInputElement) input.value = '';
      }
    })
    .catch(() => undefined);
  await mkdir(directory, { recursive: true });
  const file = join(directory, filename);
  await page.screenshot({ path: file });
  return file;
}

function relevantPath(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    return relevantRequestPattern.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function pageUrl(basePortalUrl: string, relativePath: string): string {
  const base = `${basePortalUrl.replace(/\/+$/, '')}/`;
  return new URL(relativePath.replace(/^\/+/, ''), base).toString();
}

function normalizeThrownError(error: unknown): EquatorialError {
  if (error instanceof EquatorialError) return error;
  const isTimeout = error instanceof Error && error.name === 'TimeoutError';
  return new EquatorialError(
    isTimeout
      ? EquatorialErrorCode.AUTH_TIMEOUT
      : EquatorialErrorCode.AUTHENTICATION_FAILED,
    isTimeout
      ? 'O portal não concluiu a autenticação dentro do tempo limite.'
      : 'O portal não concluiu a autenticação.',
    true,
    { cause: error },
  );
}

export function validateAuthenticationResult(
  status: number,
  payload: unknown,
): void {
  if (status === 403) {
    throw new EquatorialError(
      EquatorialErrorCode.PAGE_BLOCKED,
      'O portal bloqueou a autenticação com HTTP 403 antes de criar a sessão.',
      false,
    );
  }
  if (status === 401) {
    throw new EquatorialError(
      EquatorialErrorCode.AUTH_INVALID_CREDENTIALS,
      'A Equatorial recusou as credenciais informadas.',
      false,
    );
  }
  if (isLoginDeniedPayload(payload)) {
    throw new EquatorialError(
      EquatorialErrorCode.EQUATORIAL_LOGIN_DENIED,
      'A Equatorial recebeu o login, mas respondeu DENY.',
      true,
    );
  }
  if (status < 200 || status >= 300) {
    throw new EquatorialError(
      EquatorialErrorCode.AUTHENTICATION_FAILED,
      `A autenticação da Equatorial respondeu com HTTP ${status}.`,
      status >= 500,
    );
  }

  if (payload && typeof payload === 'object') {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) {
      throw new EquatorialError(
        EquatorialErrorCode.AUTHENTICATION_FAILED,
        'A Equatorial recusou a autenticação.',
        false,
      );
    }
  }
}

export function validateAuthenticationPostData(
  postData: string | null,
  expectedCredentials?: EquatorialCredentials,
): void {
  const data = new URLSearchParams(postData ?? '');
  const missing = requiredAuthFields.filter((field) => !data.has(field));
  const missingSecurityField = ['tokengr', 'transmit_token'].some((field) =>
    missing.includes(field as (typeof requiredAuthFields)[number]),
  );

  if (
    missingSecurityField ||
    !data.get('tokengr') ||
    !data.get('transmit_token')
  ) {
    throw new EquatorialError(
      EquatorialErrorCode.SCRIPT_LOAD_FAILED,
      'A página enviou o login sem concluir os tokens de segurança.',
      true,
    );
  }
  if (missing.length > 0 || data.get('actiongr') !== 'login') {
    throw new EquatorialError(
      EquatorialErrorCode.AUTHENTICATION_FAILED,
      'O formulário da Equatorial enviou uma estrutura diferente da esperada.',
      false,
    );
  }
  if ((data.get('username') ?? '').startsWith('1:1:')) {
    throw new EquatorialError(
      EquatorialErrorCode.AUTHENTICATION_FAILED,
      'O portal formatou o documento de maneira inválida.',
      false,
    );
  }

  const username = data.get('username') ?? '';
  const password = data.get('password') ?? '';
  if (!/^1:\d+$/.test(username) || !/^\d{4}-\d{2}-\d{2}$/.test(password)) {
    throw new EquatorialError(
      EquatorialErrorCode.AUTHENTICATION_FAILED,
      'O portal não normalizou o documento ou a data no formato esperado.',
      false,
    );
  }

  if (expectedCredentials) {
    const document = expectedCredentials.document.replace(/\D/g, '');
    const [day, month, year] = expectedCredentials.birthDate.split('/');
    if (
      username !== `1:${document}` ||
      password !== `${year}-${month}-${day}`
    ) {
      throw new EquatorialError(
        EquatorialErrorCode.AUTHENTICATION_FAILED,
        'O portal alterou as credenciais antes de enviá-las.',
        false,
      );
    }
  }
}

@Injectable()
export class EquatorialAuthService {
  private readonly logger = new Logger(EquatorialAuthService.name);

  protected launchBrowser(options: EquatorialAuthOptions): Promise<Browser> {
    return chromium.launch({
      headless: options.headless,
      ...(options.browserChannel === 'chrome'
        ? { channel: 'chrome' as const }
        : {}),
    });
  }

  async authenticate(
    credentials: EquatorialCredentials,
    options: EquatorialAuthOptions,
  ): Promise<ActiveEquatorialAuthSession> {
    return (await this.loginAndListAccounts(credentials, options)).session;
  }

  async loginAndListAccounts(
    credentials: EquatorialCredentials,
    options: EquatorialAuthOptions,
  ): Promise<EquatorialLoginResult> {
    let browser: Browser;
    try {
      browser = await this.launchBrowser(options);
    } catch (error) {
      throw new EquatorialError(
        EquatorialErrorCode.PORTAL_UNAVAILABLE,
        'Não foi possível iniciar o navegador para acessar a Equatorial.',
        true,
        { cause: error },
      );
    }

    let sessionCreated = false;
    try {
      const result = await runControlledAuthAttempts(
        options.maxAttempts ?? 3,
        options.retryDelaysMs ?? defaultRetryDelaysMs,
        async () => this.authenticateAttempt(browser, credentials, options),
        (attemptNumber, delayMs) => {
          options.onStage?.('retry_scheduled');
          this.logger.warn({
            event: 'equatorial.auth.retry_scheduled',
            attemptNumber,
            delayMs,
          });
        },
      );
      sessionCreated = true;
      return result;
    } finally {
      if (!sessionCreated) await browser.close().catch(() => undefined);
    }
  }

  private async authenticateAttempt(
    browser: Browser,
    credentials: EquatorialCredentials,
    options: EquatorialAuthOptions,
  ): Promise<EquatorialLoginResult> {
    const context = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Santarem',
      viewport: { width: 1366, height: 768 },
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    });
    let keepContext = false;

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeoutMs);
      await page.addInitScript(() => {
        Object.defineProperty(window, '__faturaSyncOriginalXhrSend', {
          configurable: false,
          enumerable: false,
          // A referência é comparada depois; ela nunca é invocada diretamente.
          // eslint-disable-next-line @typescript-eslint/unbound-method
          value: XMLHttpRequest.prototype.send,
          writable: false,
        });
      });
      this.observeRelevantNetwork(page, options);

      let initialResponse: Response | null;
      try {
        initialResponse = await page.goto(options.portalUrl, {
          waitUntil: 'domcontentloaded',
          timeout: options.timeoutMs,
        });
      } catch (error) {
        throw new EquatorialError(
          EquatorialErrorCode.PORTAL_UNAVAILABLE,
          'Não foi possível abrir o portal da Equatorial.',
          true,
          { cause: error },
        );
      }

      if (
        initialResponse &&
        [401, 403, 429].includes(initialResponse.status())
      ) {
        throw new EquatorialError(
          EquatorialErrorCode.PAGE_BLOCKED,
          `O portal bloqueou a página inicial com HTTP ${initialResponse.status()}.`,
          false,
        );
      }
      if (!initialResponse || initialResponse.status() >= 500) {
        throw new EquatorialError(
          EquatorialErrorCode.PORTAL_UNAVAILABLE,
          'O portal da Equatorial está indisponível.',
          true,
        );
      }

      options.onStage?.('portal_loaded');
      await page
        .waitForLoadState('networkidle', {
          timeout: Math.min(options.timeoutMs, 15_000),
        })
        .catch(() => undefined);

      let loginMode = await waitForLoginMode(
        page,
        options.timeoutMs,
        options.onWaitingForForm,
      );
      if (!loginMode) {
        const diagnosticFile = await captureAuthFormDiagnostic(
          page,
          options.diagnosticDirectory,
          'auth-form-unavailable.png',
        ).catch(() => undefined);
        throw new EquatorialError(
          EquatorialErrorCode.AUTH_FORM_UNAVAILABLE,
          diagnosticFile
            ? `O formulário de autenticação não apareceu. Captura salva em ${diagnosticFile}.`
            : 'O formulário de autenticação não apareceu.',
          false,
        );
      }
      options.onStage?.('form_ready');

      await waitForSecurityScripts(
        page,
        options.timeoutMs,
        loginMode === 'otp',
      );
      options.onStage?.('scripts_ready');

      if (loginMode === 'otp') {
        const otpResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().includes('/ajax-requests/otp-check'),
          { timeout: Math.min(options.timeoutMs, 15_000) },
        );

        await page.locator(otpDocumentSelector).fill(credentials.document);
        await page.locator(otpSubmitSelector).click();
        const otpResponse = await otpResponsePromise;
        options.onStage?.('otp_checked');

        if (otpResponse.status() === 403) {
          throw new EquatorialError(
            EquatorialErrorCode.PAGE_BLOCKED,
            'O portal bloqueou a verificação inicial com HTTP 403.',
            false,
          );
        }
        if (otpResponse.status() >= 500) {
          throw new EquatorialError(
            EquatorialErrorCode.AUTHENTICATION_FAILED,
            'A verificação inicial da Equatorial falhou.',
            true,
          );
        }

        const otpPayload = await readJson(otpResponse);
        if (
          otpPayload &&
          typeof otpPayload === 'object' &&
          (otpPayload as Record<string, unknown>).status === 'success'
        ) {
          options.onOtpRequired?.();
          throw new EquatorialError(
            EquatorialErrorCode.AUTHENTICATION_FAILED,
            'A Equatorial direcionou esta conta para autenticação por OTP.',
            false,
          );
        }

        if (!(await waitForBirthDateForm(page, options.timeoutMs))) {
          throw new EquatorialError(
            EquatorialErrorCode.AUTH_FORM_UNAVAILABLE,
            'O formulário de data de nascimento não apareceu após a verificação inicial.',
            true,
          );
        }
        await waitForTransmitInterceptor(page, options.timeoutMs);
        loginMode = 'birth_date';
      }

      await waitForSecurityScripts(page, options.timeoutMs, false);
      const documentInput = page.locator(documentSelector);
      const birthDateInput = page.locator(birthDateSelector);
      const loginButton = page.locator(submitSelector);
      await documentInput.fill(credentials.document);

      const inputType = await birthDateInput.getAttribute('type');
      const [day, month, year] = credentials.birthDate.split('/');
      const birthDateValue =
        inputType === 'date' && day && month && year
          ? `${year}-${month}-${day}`
          : credentials.birthDate;
      await birthDateInput.fill(birthDateValue);
      await birthDateInput.press('Tab').catch(() => undefined);

      await page.waitForFunction(
        (selector) => {
          const button = document.querySelector<HTMLButtonElement>(selector);
          return Boolean(button && !button.disabled);
        },
        submitSelector,
        { timeout: options.timeoutMs },
      );

      const accountResponsePromise = page
        .waitForResponse(
          (response) =>
            response.url().includes('/ajax-requests/ajax-uc-contas-contrato/'),
          { timeout: 0 },
        )
        .catch(() => undefined);
      const authenticationResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/ajax-requests/autenticacao'),
        { timeout: options.timeoutMs },
      );

      await loginButton.click();
      options.onStage?.('login_submitted');
      const authenticationResponse = await authenticationResponsePromise;
      validateAuthenticationPostData(
        authenticationResponse.request().postData(),
        credentials,
      );
      const authenticationPayload = await readJson(authenticationResponse);
      validateAuthenticationResult(
        authenticationResponse.status(),
        authenticationPayload,
      );
      options.onStage?.('authentication_received');

      const holderName = findHolderName(authenticationPayload);

      let token = findAccessToken(authenticationPayload);
      if (!token) {
        token = await waitForStoredToken(
          page,
          Math.min(options.timeoutMs, 10_000),
        );
      }
      if (!token) {
        const diagnosticFile = await captureAuthFormDiagnostic(
          page,
          options.diagnosticDirectory,
          'session-not-created.png',
        ).catch(() => undefined);
        throw new EquatorialError(
          EquatorialErrorCode.SESSION_NOT_CREATED,
          diagnosticFile
            ? `A autenticação respondeu, mas nenhuma sessão foi criada. Captura salva em ${diagnosticFile}.`
            : 'A autenticação respondeu, mas nenhuma sessão foi criada.',
          true,
        );
      }
      options.onStage?.('token_captured');

      const accountPage = pageUrl(options.portalUrl, 'sua-conta/');
      await page
        .waitForURL(/\/siteantigo\/sua-conta\/?(?:[?#].*)?$/, {
          timeout: Math.min(options.timeoutMs, 10_000),
        })
        .catch(() => undefined);
      if (!/\/siteantigo\/sua-conta\/?(?:[?#].*)?$/.test(page.url())) {
        await page.goto(accountPage, {
          waitUntil: 'domcontentloaded',
          timeout: options.timeoutMs,
        });
      }

      const accountResponse = await Promise.race([
        accountResponsePromise,
        page
          .waitForTimeout(Math.min(options.timeoutMs, 5_000))
          .then(() => undefined),
      ]);
      let accountsPayload: unknown;
      if (accountResponse) {
        if (accountResponse.status() === 403) {
          throw new EquatorialError(
            EquatorialErrorCode.PAGE_BLOCKED,
            'O portal bloqueou a consulta das unidades consumidoras.',
            false,
          );
        }
        if (accountResponse.status() < 200 || accountResponse.status() >= 300) {
          throw new EquatorialError(
            EquatorialErrorCode.ACCOUNT_LIST_FAILED,
            `A consulta das unidades consumidoras respondeu com HTTP ${accountResponse.status()}.`,
            accountResponse.status() >= 500,
          );
        }
        accountsPayload = await readJson(accountResponse);
      } else {
        const accountsUrl = pageUrl(
          options.portalUrl,
          'ajax-requests/ajax-uc-contas-contrato/',
        );
        const fallback = await page.evaluate(
          async ({ url, accessToken }) => {
            const response = await fetch(url, {
              headers: {
                accept: 'application/json',
                authorization: `Bearer ${accessToken}`,
              },
              credentials: 'include',
            });
            const body = (await response
              .json()
              .catch(() => undefined)) as unknown;
            return { status: response.status, body };
          },
          { url: accountsUrl, accessToken: token },
        );
        if (fallback.status < 200 || fallback.status >= 300) {
          throw new EquatorialError(
            EquatorialErrorCode.ACCOUNT_LIST_FAILED,
            `A consulta das unidades consumidoras respondeu com HTTP ${fallback.status}.`,
            fallback.status >= 500,
          );
        }
        accountsPayload = fallback.body;
      }

      const accounts = requireEquatorialAccounts(accountsPayload).map((account) => ({
        ...account,
        ...(holderName ? { holderName } : {}),
      }));
      options.onStage?.('accounts_loaded');

      const apiPage = await prepareApiCookieContext(
        context,
        options.apiUrl,
        options.timeoutMs,
      );
      options.onStage?.('api_context_ready');
      const userAgent = await page.evaluate(() => navigator.userAgent);
      const availableAccounts = [
        ...new Set([
          ...accounts.map((account) => account.id),
          ...findContractAccounts(token),
        ]),
      ];

      let closed = false;
      keepContext = true;
      const session: ActiveEquatorialAuthSession = {
        accessToken: token,
        authenticatedAt: new Date(),
        loginMode,
        cookieHeader: await buildCookieHeader(context),
        userAgent,
        portalOrigin: new URL(options.portalUrl).origin,
        availableAccounts,
        linkedAccounts: accounts,
        requestJsonFromBrowser: async (url: string) => {
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
              let body: unknown;
              try {
                body = text ? (JSON.parse(text) as unknown) : undefined;
              } catch {
                body = undefined;
              }
              return { status: response.status, body };
            },
            { requestUrl: url, accessToken: token },
          );
        },
        close: async () => {
          if (closed) return;
          closed = true;
          await context.close().catch(() => undefined);
          await browser.close().catch(() => undefined);
        },
      };

      options.onStage?.('session_ready');
      return { session, accounts };
    } catch (error) {
      throw normalizeThrownError(error);
    } finally {
      if (!keepContext) await context.close().catch(() => undefined);
    }
  }

  private observeRelevantNetwork(
    page: Page,
    options: EquatorialAuthOptions,
  ): void {
    const emit = (event: EquatorialNetworkEvent): void => {
      options.onNetworkEvent?.(event);
      this.logger.log({ event: 'equatorial.network', ...event });
    };

    page.on('request', (request) => {
      const path = relevantPath(request.url());
      if (!path) return;
      emit({
        type: 'request',
        method: request.method(),
        path,
        postFieldNames: getPostFieldNames(request.postData()),
      });
    });
    page.on('response', (response) => {
      const path = relevantPath(response.url());
      if (!path) return;
      emit({
        type: 'response',
        status: response.status(),
        path,
        contentType: response.headers()['content-type'] ?? '',
      });
    });
  }
}
