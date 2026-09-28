/* global chrome, URL, setTimeout, clearTimeout */
import {
  API_ORIGIN,
  PORTAL_ORIGIN,
  isPdfBase64,
  listAccountsFromPortal,
  parseAccounts,
  parseInvoices,
  probePortalSession,
  readAccessTokenForRequest,
  requestFromApiContext,
} from '../equatorial/client.js';


chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'bode.portal-ready') {
    sendResponse({ ok: true });
    return;
  }

  void handleMessage(message)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => sendResponse({ ok: false, error: safeMessage(error) }));
  return true;
});

async function handleMessage(message) {
  const tab = await activePortalTab();

  switch (message?.type) {
    case 'bode.status':
      return sessionStatus(tab.id);
    case 'bode.accounts':
      return accounts(tab.id);
    case 'bode.invoices':
      return invoices(tab.id, message.account);
    case 'bode.download':
      return download(tab.id, message.account, message.holderName, message.invoiceNumber, message.competence);
    default:
      throw new Error('Operação desconhecida.');
  }
}

async function activePortalTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith(PORTAL_ORIGIN)) {
    throw new Error('Abra o portal da Equatorial e faça login antes de usar o BODE.');
  }
  if (!new URL(tab.url).pathname.startsWith('/siteantigo')) {
    throw new Error('Abra o portal antigo da Equatorial antes de usar o BODE.');
  }
  return tab;
}

async function executeInPage(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args,
  });
  return result?.result;
}

async function sessionStatus(tabId) {
  const result = await executeInPage(tabId, probePortalSession);
  return { authenticated: result?.authenticated === true };
}

async function accounts(tabId) {
  const result = await executeInPage(tabId, listAccountsFromPortal);
  assertSuccess(result?.status, 'Não foi possível consultar as unidades consumidoras.');
  const accounts = parseAccounts(result.body);
  if (accounts.length === 0) {
    throw new Error('A sessão está ativa, mas não retornou nenhuma unidade consumidora.');
  }
  return accounts;
}

async function invoices(tabId, account) {
  const url = new URL(`/api/v1/debitos/${encodeURIComponent(requireText(account))}`, API_ORIGIN);
  url.searchParams.set('listarEmAberto', 'false');
  const result = await requestWithCurrentSession(tabId, url.toString());
  assertSuccess(result.status, 'Não foi possível consultar as faturas.');
  return parseInvoices(result.body);
}

async function download(tabId, account, holderName, invoiceNumber, competence) {
  const url = new URL(`/api/v1/faturas/segunda-via/${encodeURIComponent(requireText(invoiceNumber))}`, API_ORIGIN);
  url.searchParams.set('contaContrato', requireText(account));
  const result = await requestWithCurrentSession(tabId, url.toString());
  assertSuccess(result.status, 'Não foi possível baixar a fatura.');
  const base64 = result.body?.data?.base64;
  if (!isPdfBase64(base64)) throw new Error('A Equatorial não retornou um PDF válido.');

  const holderDirectory = safePathSegment(holderName, 'Titular não informado');
  const accountDirectory = safePathSegment(account, 'Conta não informada');
  const filename = `BODE/${holderDirectory}/${accountDirectory}/${safeFilename(competence).replace('/', '-')}.pdf`;
  await chrome.downloads.download({
    url: `data:application/pdf;base64,${base64}`,
    filename,
    saveAs: false,
  });
  return { filename };
}

async function requestWithCurrentSession(portalTabId, requestUrl) {
  let accessToken;
  let apiTabId;
  try {
    accessToken = await executeInPage(portalTabId, readAccessTokenForRequest);
    if (!accessToken) throw new Error('A sessão da Equatorial não está autenticada. Faça login novamente.');

    const apiTab = await chrome.tabs.create({ url: API_ORIGIN, active: false });
    if (!apiTab.id) throw new Error('Não foi possível preparar o contexto da API.');
    apiTabId = apiTab.id;
    await waitForTabLoad(apiTabId);
    return await executeInPage(apiTabId, requestFromApiContext, [accessToken, requestUrl]);
  } finally {
    if (apiTabId) await chrome.tabs.remove(apiTabId).catch(() => undefined);
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('A API da Equatorial demorou para responder.')), 15_000);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const finish = (error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function assertSuccess(status, fallback) {
  if (status >= 200 && status < 300) return;
  if (status === 401) throw new Error('A sessão expirou. Faça login novamente na Equatorial.');
  if (status === 403) throw new Error('A Equatorial recusou esta sessão. Verifique o portal e tente novamente.');
  throw new Error(fallback);
}

function requireText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Dados de consulta inválidos.');
  return value;
}

function safeFilename(value) {
  return String(value).replace(/[<>:"\\|?*]/g, '_');
}

function safePathSegment(value, fallback) {
  const segment = safeFilename(value || '').replaceAll('/', '_').trim();
  return segment || fallback;
}

function safeMessage(error) {
  return error instanceof Error ? error.message.slice(0, 240) : 'Falha inesperada.';
}
