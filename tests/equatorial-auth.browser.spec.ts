import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EquatorialAuthService } from '../src/providers/equatorial/equatorial-auth.service';
import type { EquatorialAuthOptions } from '../src/providers/equatorial/equatorial.types';

const jwt =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJicm93c2VyLXRlc3QiLCJleHAiOjk5OTk5OTk5OTl9.browser-test-signature';

type PortalMode =
  'success' | 'deny-once' | 'page-blocked' | 'script-failure' | 'otp-failure';

let server: Server;
let baseUrl = '';
let mode: PortalMode = 'success';
let authenticationRequests = 0;
let portalRequestCookies: Array<string | undefined> = [];

function loginPage(includeSecurityScripts: boolean): string {
  const securityScripts = includeSecurityScripts
    ? `
      window.grecaptcha = {
        execute() {},
        ready(callback) { callback(); },
        enterprise: { execute() {}, ready(callback) { callback(); } }
      };
      window.tsPlatform = {
        drs: {
          async triggerActionEvent() {
            const originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function(data) {
              if (this.__url && this.__url.includes('/autenticacao')) {
                const params = new URLSearchParams(data);
                params.append('transmit_token', 'generated-by-page');
                params.append('transmit_user', ' ');
                data = params.toString();
              }
              return originalSend.call(this, data);
            };
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
              this.__url = url;
              return originalOpen.apply(this, arguments);
            };
            return { actionToken: 'generated-by-page' };
          }
        }
      };`
    : '';

  return `<!doctype html>
    <html lang="pt-BR"><body>
      <form id="login-box-form-otp">
        <input id="identificador-otp" name="cpf-novo-otp">
        <button id="envia-identificador-otp" type="submit">Entrar</button>
      </form>
      <form id="login-box-form" style="display:none">
        <input id="identificador">
        <input id="senha-identificador" type="text">
        <button id="envia-identificador" type="submit">Autenticar</button>
      </form>
      <script>
        ${securityScripts}
        const otpForm = document.querySelector('#login-box-form-otp');
        const authForm = document.querySelector('#login-box-form');
        otpForm.addEventListener('submit', async event => {
          event.preventDefault();
          const securityReady = window.tsPlatform?.drs?.triggerActionEvent('start_id_pa');
          const response = await fetch('/siteantigo/ajax-requests/otp-check', {
            method: 'POST', body: new FormData(otpForm)
          });
          const data = await response.json().catch(() => ({}));
          if (data.status !== 'success') {
            await securityReady;
            document.querySelector('#identificador').value =
              document.querySelector('#identificador-otp').value;
            otpForm.remove();
            authForm.style.display = 'block';
          }
        });
        authForm.addEventListener('submit', event => {
          event.preventDefault();
          const birthDate = document.querySelector('#senha-identificador').value;
          const [day, month, year] = birthDate.split('/');
          const documentValue = document.querySelector('#identificador').value.replace(/\\D/g, '');
          const body = new URLSearchParams({
            grant_type: 'password', username: '1:' + documentValue,
            password: year + '-' + month + '-' + day, actiongr: 'login',
            tokengr: 'generated-by-page', navegador: 'Chrome',
            dispositivo: 'desktop', empresaId: '1'
          });
          const request = new XMLHttpRequest();
          request.open('POST', '/siteantigo/ajax-requests/autenticacao');
          request.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          request.addEventListener('load', () => {
            if (request.status !== 200) return;
            const data = JSON.parse(request.responseText);
            localStorage.setItem('access_token', data.auth.access_token);
          });
          request.send(body.toString());
        });
      </script>
    </body></html>`;
}

function accountPage(): string {
  return `<!doctype html><html><body><script>
    fetch('/siteantigo/ajax-requests/ajax-uc-contas-contrato/', {
      headers: { authorization: 'Bearer ' + localStorage.getItem('access_token') }
    });
  </script></body></html>`;
}

function options(
  overrides: Partial<EquatorialAuthOptions> = {},
): EquatorialAuthOptions {
  return {
    portalUrl: `${baseUrl}/siteantigo`,
    apiUrl: baseUrl,
    headless: true,
    timeoutMs: 2_000,
    browserChannel: 'chromium',
    persistentContext: false,
    userDataDirectory: '/tmp/fatura-sync-browser-test',
    diagnosticDirectory: '/tmp/fatura-sync-browser-test-debug',
    maxAttempts: 1,
    retryDelaysMs: [0, 0],
    ...overrides,
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/siteantigo' || path === '/siteantigo/') {
      portalRequestCookies.push(request.headers.cookie);
      if (mode === 'page-blocked') {
        response.writeHead(403).end('blocked');
        return;
      }
      response.setHeader(
        'Set-Cookie',
        `attempt=${portalRequestCookies.length}; Path=/`,
      );
      response.setHeader('Content-Type', 'text/html');
      response.end(loginPage(mode !== 'script-failure'));
      return;
    }
    if (path.endsWith('/otp-check')) {
      if (mode === 'otp-failure') {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'temporary' }));
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: 'legacy' }));
      return;
    }
    if (path.endsWith('/autenticacao')) {
      authenticationRequests += 1;
      response.setHeader('Content-Type', 'application/json');
      if (mode === 'deny-once' && authenticationRequests === 1) {
        response.statusCode = 500;
        response.end(
          JSON.stringify({ error: 'DENY', error_description: 'DENY' }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          auth: { access_token: jwt },
          dados_complementares: { nome: 'Ana', sobrenome: 'da Silva' },
        }),
      );
      return;
    }
    if (path === '/siteantigo/sua-conta/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(accountPage());
      return;
    }
    if (path.endsWith('/ajax-uc-contas-contrato/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify([
          { numero: '000123', numeroInstalacao: '456', ucMascarada: '***123' },
          { numero: '000789', numeroInstalacao: '012', ucMascarada: '***789' },
        ]),
      );
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><body>API</body></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test server unavailable');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  mode = 'success';
  authenticationRequests = 0;
  portalRequestCookies = [];
});

describe('EquatorialAuthService no navegador', () => {
  it('refaz DENY em contexto limpo e confirma sessão e múltiplas contas sem navegação automática', async () => {
    mode = 'deny-once';
    const networkEvents: unknown[] = [];
    const result = await new EquatorialAuthService().loginAndListAccounts(
      { document: '00000000000', birthDate: '01/01/1990' },
      options({
        maxAttempts: 2,
        onNetworkEvent: (event) => networkEvents.push(event),
      }),
    );

    expect(authenticationRequests).toBe(2);
    expect(portalRequestCookies).toEqual([undefined, undefined]);
    expect(result.accounts.map((account) => account.id)).toEqual([
      '000123',
      '000789',
    ]);
    expect(result.accounts.map((account) => account.holderName)).toEqual([
      'Ana da Silva',
      'Ana da Silva',
    ]);
    expect(result.session.availableAccounts).toEqual(['000123', '000789']);
    expect(JSON.stringify(networkEvents)).not.toContain('00000000000');
    expect(JSON.stringify(networkEvents)).not.toContain('generated-by-page');
    await result.session.close();
  }, 15_000);

  it('classifica página bloqueada, script ausente e falha do otp-check', async () => {
    const service = new EquatorialAuthService();
    mode = 'page-blocked';
    await expect(
      service.loginAndListAccounts(
        { document: '00000000000', birthDate: '01/01/1990' },
        options({ timeoutMs: 500 }),
      ),
    ).rejects.toMatchObject({ code: 'PAGE_BLOCKED' });

    mode = 'script-failure';
    await expect(
      service.loginAndListAccounts(
        { document: '00000000000', birthDate: '01/01/1990' },
        options({ timeoutMs: 500 }),
      ),
    ).rejects.toMatchObject({ code: 'SCRIPT_LOAD_FAILED' });

    mode = 'otp-failure';
    await expect(
      service.loginAndListAccounts(
        { document: '00000000000', birthDate: '01/01/1990' },
        options({ timeoutMs: 1_000 }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  }, 15_000);
});
