/* global window, fetch, URL, atob, console, XMLHttpRequest */
export const PORTAL_ORIGIN = 'https://pa.equatorialenergia.com.br';
export const API_ORIGIN = 'https://api-pa-cliente.equatorialenergia.com.br';
const holderNameStorageKey = 'bode.equatorial.holder-name';
const authenticationCaptureFlag = '__bodeAuthenticationCaptureInstalled';

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
 * Instala, antes do login, uma escuta restrita à resposta de autenticação do
 * portal. Só o nome montado é guardado na sessionStorage da própria aba; token
 * e credenciais jamais são lidos ou enviados à extensão.
 */
export function installAuthenticationHolderCapture() {
  if (window[authenticationCaptureFlag]) return;
  window[authenticationCaptureFlag] = true;

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    const requestUrl = new URL(String(url), window.location.href);
    const isAuthenticationRequest =
      String(method).toUpperCase() === 'POST' &&
      requestUrl.pathname.endsWith('/siteantigo/ajax-requests/autenticacao');

    if (isAuthenticationRequest) {
      this.addEventListener('loadend', () => {
        if (this.status < 200 || this.status >= 300) return;
        try {
          const holderName = parseHolderName(JSON.parse(this.responseText));
          if (holderName) window.sessionStorage.setItem(holderNameStorageKey, holderName);
        } catch {
          // Uma resposta inesperada não deve afetar a autenticação do portal.
        }
      });
    }

    return originalOpen.call(this, method, url, ...rest);
  };
}

export function readCapturedHolderName() {
  return optionalString(window.sessionStorage.getItem(holderNameStorageKey))?.trim() || undefined;
}

/**
 * Lê somente os dados de identificação já presentes na sessão do portal.
 * O JWT nunca deixa o contexto da página: dele retornamos apenas nome e o
 * vínculo entre conta-contrato e UC.
 */
export function readPortalProfile() {
  const token = readToken();
  const jwtData = parseJwtPayload(token);
  const complementaryData = readComplementaryData();
  const jwtHolderName = [jwtData?.userData?.Nome, jwtData?.userData?.Sobrenome]
    .map(optionalString).filter(Boolean).join(' ') || undefined;
  const holderName =
    parseHolderName({ dados_complementares: complementaryData }) ??
    readCapturedHolderName() ??
    jwtHolderName;
  const accounts = Array.isArray(jwtData?.userData?.ContasContrato)
    ? jwtData.userData.ContasContrato.map((account) => ({
      id: optionalString(account?.Numero ?? account?.numero),
      consumerUnitNumber: optionalString(account?.UcMascarada ?? account?.ucMascarada ?? account?.Uc ?? account?.uc),
      installationNumber: optionalString(account?.NumeroInstalacao ?? account?.numeroInstalacao),
    })).filter((account) => account.id)
    : [];
  return { holderName, accounts };
}

/**
 * Busca as contas no mesmo contexto do portal autenticado. O token fica
 * fechado nesta função e não é enviado à extensão.
 */
export async function listAccountsFromPortal() {
  const token = readToken();
  if (!token) return {
    status: 401,
    body: undefined,
    diagnostic: { operation: 'units', status: 401, reason: 'token ausente' },
  };

  // O próprio portal preenche este cache após autenticar. Preferi-lo evita uma
  // segunda chamada desnecessária e mantém o mesmo comportamento da página.
  const cachedAccounts = readAccountCache();
  if (cachedAccounts) return {
    status: 200,
    body: cachedAccounts,
    diagnostic: { operation: 'units', status: 200, source: 'cache da sessão' },
  };

  const path = '/siteantigo/ajax-requests/ajax-uc-contas-contrato/';
  try {
    const response = await fetch(new URL(path, window.location.origin), {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    const body = await response.json().catch(() => undefined);
    const diagnostic = {
      operation: 'units',
      status: response.status,
      contentType: response.headers.get('content-type') || 'ausente',
      response: summarizeResponse(body),
    };
    if (!response.ok) console.warn('[BODEE] Falha ao consultar unidades', diagnostic);
    return { status: response.status, body, diagnostic };
  } catch (error) {
    const diagnostic = {
      operation: 'units',
      status: 0,
      reason: error instanceof Error ? error.name : 'erro de rede desconhecido',
    };
    console.warn('[BODEE] Erro de rede ao consultar unidades', diagnostic);
    return { status: 0, body: undefined, diagnostic };
  }
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
    const id = item.numero ?? item.Numero ?? item.id ?? item.contaContrato ?? item.ContaContrato ?? item.uc ?? item.Uc;
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    const text = String(id);
    byId.set(text, {
      id: text,
      holderName: optionalString(
        item.nomeTitular ?? item.NomeTitular ?? item.nomeDoTitular ?? item.nomeCliente ?? item.titular ?? item.nome ?? item.razaoSocial,
      ),
      consumerUnitNumber: optionalString(
        item.ucMascarada ?? item.UcMascarada ?? item.uc ?? item.Uc ??
        item.unidadeConsumidora ?? item.codigoUnidadeConsumidora ?? item.numeroInstalacao ?? item.NumeroInstalacao,
      ),
      installationNumber: optionalString(item.numeroInstalacao ?? item.NumeroInstalacao),
      address: optionalString(item.endereco ?? item.Endereco),
      city: optionalString(item.cidade ?? item.Cidade),
    });
  }
  return [...byId.values()];
}

export function parseHolderName(value) {
  const complementaryData = value?.dados_complementares;
  if (!complementaryData || typeof complementaryData !== 'object') return undefined;

  const parts = [complementaryData.nome, complementaryData.sobrenome]
    .map(optionalString)
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
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

/** Metadados sem valores da resposta, seguros para diagnóstico no cliente. */
function summarizeResponse(value) {
  if (Array.isArray(value)) return `lista (${value.length} item(ns))`;
  if (!value || typeof value !== 'object') return value === undefined ? 'não JSON' : typeof value;
  return `objeto (${Object.keys(value).slice(0, 8).join(', ') || 'sem campos'})`;
}

function readToken() {
  const tokenKeys = ['access_token', 'accessToken', 'jwt'];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of tokenKeys) {
      const value = storage.getItem(key);
      if (value && value.split('.').length === 3) return value;
    }
  }
  return undefined;
}

function readAccountCache() {
  try {
    const value = JSON.parse(window.localStorage.getItem('contasContrato') || '');
    return Array.isArray(value) && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function readComplementaryData() {
  for (const key of ['dados_complementares', 'dadosComplementares']) {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(key) || '');
      if (value && typeof value === 'object') return value;
    } catch {
      // A ausência desse cache é normal em sessões iniciadas antes da extensão.
    }
  }
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    try {
      const key = window.sessionStorage.key(index);
      const value = key && JSON.parse(window.sessionStorage.getItem(key) || '');
      if (value && typeof value === 'object' && (value.nome || value.sobrenome)) return value;
    } catch {
      // Outros valores da sessão não fazem parte dos dados cadastrais.
    }
  }
  return undefined;
}

function parseJwtPayload(token) {
  if (!token) return undefined;
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const text = decodeURIComponent([...atob(payload)].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
