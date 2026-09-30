/* global chrome, URL, setTimeout, clearTimeout */
import {
  API_ORIGIN,
  PORTAL_ORIGIN,
  isPdfBase64,
  installAuthenticationHolderCapture,
  listAccountsFromPortal,
  parseAccounts,
  parseInvoices,
  probePortalSession,
  readPortalProfile,
  readAccessTokenForRequest,
  requestFromApiContext,
} from '../equatorial/client.js';
import { downloadFilename } from '../shared/download-path.js';
import { assertEquatorialSuccess } from '../shared/equatorial-errors.js';

const downloadJobStorageKey = 'bode.download-job';
const downloadQueueAlarm = 'bode.download-queue';


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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === downloadQueueAlarm) void processDownloadQueue();
});

async function handleMessage(message) {
  if (!message || typeof message.type !== 'string') throw new Error('Mensagem inválida.');

  switch (message?.type) {
    case 'bode.status':
      return sessionStatusFromActiveTab();
    case 'bode.open-portal':
      return openPortal();
    case 'bode.accounts':
      return accounts((await activePortalTab()).id);
    case 'bode.invoices':
      return invoices((await activePortalTab()).id, requireText(message.account));
    case 'bode.download':
      return download((await activePortalTab()).id, message.account, message.holderName, message.consumerUnitNumber, message.invoiceNumber, message.competence);
    case 'bode.download-batch':
      return downloadBatch((await activePortalTab()).id, message.downloads);
    case 'bode.download-queue':
      return startDownloadQueue((await activePortalTab()).id, message.downloads);
    case 'bode.download-status':
      return readDownloadJob();
    default:
      throw new Error('Operação desconhecida.');
  }
}

async function startDownloadQueue(portalTabId, downloads) {
  if (!Array.isArray(downloads) || downloads.length === 0 || downloads.length > 120) {
    throw new Error('Nenhuma fatura foi selecionada para download.');
  }
  const existing = await readDownloadJob();
  if (existing?.status === 'RUNNING') throw new Error('Já existe um download em andamento.');

  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'RUNNING',
    portalTabId,
    total: downloads.length,
    complete: 0,
    failed: 0,
    items: downloads.map((item) => ({ ...item, status: 'PENDING' })),
  };
  await saveDownloadJob(job);
  await chrome.alarms.create(downloadQueueAlarm, { periodInMinutes: 0.5 });
  void processDownloadQueue();
  return job;
}

async function processDownloadQueue() {
  while (true) {
    const job = await readDownloadJob();
    if (!job || job.status !== 'RUNNING') return;

    const item = job.items.find((candidate) => candidate.status === 'PENDING' || candidate.status === 'DOWNLOADING');
    if (!item) {
      job.status = 'COMPLETED';
      await saveDownloadJob(job);
      await chrome.alarms.clear(downloadQueueAlarm);
      return;
    }

    item.status = 'DOWNLOADING';
    await saveDownloadJob(job);
    try {
      const result = await download(
        job.portalTabId,
        item.account,
        item.holderName,
        item.consumerUnitNumber,
        item.invoiceNumber,
        item.competence,
      );
      item.status = 'COMPLETED';
      item.filename = result.filename;
      job.complete += 1;
    } catch (error) {
      item.status = 'FAILED';
      item.error = safeMessage(error);
      job.failed += 1;
    }
    await saveDownloadJob(job);
  }
}

async function readDownloadJob() {
  const stored = await chrome.storage.session.get(downloadJobStorageKey);
  return stored[downloadJobStorageKey];
}

async function saveDownloadJob(job) {
  await chrome.storage.session.set({ [downloadJobStorageKey]: job });
}

async function sessionStatusFromActiveTab() {
  const tab = await activePortalTab(false);
  return tab ? sessionStatus(tab.id) : { authenticated: false };
}

async function activePortalTab(required = true) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith(PORTAL_ORIGIN)) {
    if (!required) return undefined;
    throw new Error('Abra o portal da Equatorial e faça login antes de usar o BODEE.');
  }
  if (!new URL(tab.url).pathname.startsWith('/siteantigo')) {
    if (!required) return undefined;
    throw new Error('Abra o portal antigo da Equatorial antes de usar o BODEE.');
  }
  return tab;
}

async function openPortal() {
  const tab = await chrome.tabs.create({ url: `${PORTAL_ORIGIN}/siteantigo/`, active: true });
  if (tab.id) {
    await executeInPage(tab.id, installAuthenticationHolderCapture).catch(() => undefined);
  }
  return { tabId: tab.id };
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
  await executeInPage(tabId, installAuthenticationHolderCapture).catch(() => undefined);
  const result = await executeInPage(tabId, probePortalSession);
  return { authenticated: result?.authenticated === true };
}

async function accounts(tabId) {
  const result = await executeInPage(tabId, listAccountsFromPortal);
  assertEquatorialSuccess(result?.status, 'Não foi possível consultar as unidades consumidoras.');
  const profile = await executeInPage(tabId, readPortalProfile);
  const profileAccounts = new Map((profile?.accounts || []).map((account) => [account.id, account]));
  const accounts = parseAccounts(result.body).map((account) => ({
    ...account,
    ...(profile?.holderName && !account.holderName ? { holderName: profile.holderName } : {}),
    ...(profileAccounts.get(account.id)?.consumerUnitNumber
      ? { consumerUnitNumber: profileAccounts.get(account.id).consumerUnitNumber }
      : {}),
    ...(profileAccounts.get(account.id)?.installationNumber && !account.installationNumber
      ? { installationNumber: profileAccounts.get(account.id).installationNumber }
      : {}),
  }));
  if (accounts.length === 0) {
    throw new Error('A sessão está ativa, mas não retornou nenhuma unidade consumidora.');
  }
  return accounts;
}

async function invoices(tabId, account) {
  const url = new URL(`/api/v1/debitos/${encodeURIComponent(requireText(account))}`, API_ORIGIN);
  url.searchParams.set('listarEmAberto', 'false');
  const result = await requestWithCurrentSession(tabId, url.toString());
  assertEquatorialSuccess(result.status, 'Não foi possível consultar as faturas.');
  return parseInvoices(result.body);
}

async function download(tabId, account, holderName, consumerUnitNumber, invoiceNumber, competence) {
  const url = new URL(`/api/v1/faturas/segunda-via/${encodeURIComponent(requireText(invoiceNumber))}`, API_ORIGIN);
  url.searchParams.set('contaContrato', requireText(account));
  const result = await requestWithCurrentSession(tabId, url.toString());
  assertEquatorialSuccess(result.status, 'Não foi possível baixar a fatura.');
  const base64 = result.body?.data?.base64;
  if (!isPdfBase64(base64)) throw new Error('A Equatorial não retornou um PDF válido.');

  const filename = downloadFilename(holderName, consumerUnitNumber, account, requireText(competence));
  await chrome.downloads.download({
    url: `data:application/pdf;base64,${base64}`,
    filename,
    saveAs: false,
  });
  return { filename };
}

async function downloadBatch(tabId, downloads) {
  if (!Array.isArray(downloads) || downloads.length === 0 || downloads.length > 120) {
    throw new Error('Nenhuma fatura foi selecionada para download.');
  }

  let complete = 0;
  let failed = 0;
  for (const item of downloads) {
    try {
      if (!item || typeof item !== 'object') throw new Error('Item de download inválido.');
      await download(
        tabId,
        item?.account,
        item?.holderName,
        item?.consumerUnitNumber,
        item?.invoiceNumber,
        item?.competence,
      );
      complete += 1;
    } catch {
      failed += 1;
    }
  }
  return { complete, failed };
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

function requireText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Dados de consulta inválidos.');
  return value;
}

function safeMessage(error) {
  return error instanceof Error ? error.message.slice(0, 240) : 'Falha inesperada.';
}
