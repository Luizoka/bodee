/* global window, fetch, URL, atob */
export const PORTAL_ORIGIN = 'https://pa.equatorialenergia.com.br';
export const API_ORIGIN = 'https://api-pa-cliente.equatorialenergia.com.br';

/**
 * Esta função é injetada no mundo principal da página. Não retorne o token:
 * ele deve viver somente durante a execução da chamada autenticada.
 */
export async function probePortalSession() {
  const tokenKeys = ['access_token', 'accessToken', 'jwt'];
  const readToken = () => {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of tokenKeys) {
        const value = storage.getItem(key);
        if (value && value.split('.').length === 3) return value;
      }
    }
    return undefined;
  };

  return { authenticated: Boolean(readToken()) };
}

/**
 * Busca as contas no mesmo contexto do portal autenticado. O token fica
 * fechado nesta função e não é enviado à extensão.
 */
export async function listAccountsFromPortal() {
  const tokenKeys = ['access_token', 'accessToken', 'jwt'];
  const readToken = () => {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of tokenKeys) {
        const value = storage.getItem(key);
        if (value && value.split('.').length === 3) return value;
      }
    }
    return undefined;
  };

  const token = readToken();
  if (!token) return { status: 401, body: undefined };

  const response = await fetch(
    new URL('/siteantigo/ajax-requests/ajax-uc-contas-contrato/', window.location.origin),
    {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      credentials: 'include',
    },
  );
  const body = await response.json().catch(() => undefined);
  return { status: response.status, body };
}

/**
 * Executada numa aba temporária da origem da API. O valor de accessToken é
 * recebido apenas como argumento de execução e não é escrito em storage.
 */
export async function requestFromApiContext(accessToken, requestUrl) {
  const response = await fetch(requestUrl, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  const body = await response.json().catch(() => undefined);
  return { status: response.status, body };
}

/** Retorna o token somente para uma operação imediata em memória. */
export async function readAccessTokenForRequest() {
  const tokenKeys = ['access_token', 'accessToken', 'jwt'];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of tokenKeys) {
      const value = storage.getItem(key);
      if (value && value.split('.').length === 3) return value;
    }
  }
  return undefined;
}

export function parseAccounts(value) {
  if (!Array.isArray(value)) return [];

  const byId = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = item.numero ?? item.id ?? item.contaContrato ?? item.uc;
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    const text = String(id);
    byId.set(text, {
      id: text,
      installationNumber: optionalString(item.numeroInstalacao),
      address: optionalString(item.endereco),
      city: optionalString(item.cidade),
    });
  }
  return [...byId.values()];
}

export function parseInvoices(value) {
  const invoices = value?.data?.faturas;
  if (!Array.isArray(invoices)) return [];

  return invoices
    .map((invoice) => ({
      invoiceNumber: String(invoice?.numeroFatura ?? ''),
      competence: typeof invoice?.competencia === 'string' ? invoice.competencia : '',
    }))
    .filter((invoice) => invoice.invoiceNumber && invoice.competence);
}

export function isPdfBase64(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    return atob(value.slice(0, 24)).startsWith('%PDF-');
  } catch {
    return false;
  }
}

function optionalString(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
