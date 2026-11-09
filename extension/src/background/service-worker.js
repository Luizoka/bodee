/* global chrome, URL, setTimeout, clearTimeout, console */
import {
  API_ORIGIN,
  EQUATORIAL_SITES,
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
const lastDiagnosticStorageKey = 'bode.last-diagnostic';
let downloadQueueProcessor;
let isStartingDownloadQueue = false;
const cancelledDownloadJobs = new Set();


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
  if (alarm.name === downloadQueueAlarm) void scheduleDownloadQueueProcessing();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isPortalPageUrl(tab?.url)) {
    void invalidatePopupCacheForCurrentLogin(tabId);
  }
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
    case 'bode.invoices': {
      const portal = await activePortalTab();
      return invoices(portal.id, requireText(message.account), message.openOnly === true, portal.apiOrigin);
    }
    case 'bode.download': {
      const portal = await activePortalTab();
      return download(portal.id, message.account, message.holderName, message.consumerUnitNumber, message.invoiceNumber, message.competence, portal.apiOrigin);
    }
    case 'bode.download-batch': {
      const portal = await activePortalTab();
      return downloadBatch(portal.id, message.downloads, portal.apiOrigin);
    }
    case 'bode.download-queue': {
      const portal = await activePortalTab();
      return startDownloadQueue(portal.id, message.downloads, portal.apiOrigin);
    }
    case 'bode.download-status':
      return readDownloadJob();
    case 'bode.download-cancel':
      return cancelDownloadQueue();
    case 'bode.download-retry':
      return retryDownloadItem(message.itemId);
    case 'bode.last-diagnostic':
      return readLastDiagnostic();
    default:
      throw new Error('Operação desconhecida.');
  }
}

async function retryDownloadItem(itemId) {
  const job = await readDownloadJob();
  if (!job || job.status === 'RUNNING') throw new Error('Aguarde a fila atual terminar.');
  const item = job.items.find((candidate) => candidate.id === itemId && candidate.status === 'FAILED');
  if (!item) throw new Error('Este item não está disponível para nova tentativa.');
  item.status = 'PENDING';
  delete item.error;
  job.status = 'RUNNING';
  updateDownloadJobCounts(job);
  await saveDownloadJob(job);
  await chrome.alarms.create(downloadQueueAlarm, { periodInMinutes: 0.5 });
  void scheduleDownloadQueueProcessing();
  return job;
}

async function startDownloadQueue(portalTabId, downloads, apiOrigin = API_ORIGIN) {
  if (!Array.isArray(downloads) || downloads.length === 0 || downloads.length > 120) {
    throw new Error('Nenhuma fatura foi selecionada para download.');
  }
  // O popup pode enviar dois cliques antes de ficar desabilitado. A trava é
  // local porque as duas mensagens são atendidas pelo mesmo service worker.
  if (isStartingDownloadQueue) throw new Error('Já existe um download em andamento.');
  isStartingDownloadQueue = true;
  try {
    const existing = await readDownloadJob();
    if (existing?.status === 'RUNNING') throw new Error('Já existe um download em andamento.');

    const items = uniqueDownloadItems(downloads);
    const job = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'RUNNING',
      portalTabId,
      apiOrigin,
      profileKey: await currentProfileKey(portalTabId),
      total: items.length,
      complete: 0,
      failed: 0,
      items: items.map((item) => ({ ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'PENDING' })),
    };
    await saveDownloadJob(job);
    await chrome.alarms.create(downloadQueueAlarm, { periodInMinutes: 0.5 });
    void scheduleDownloadQueueProcessing();
    return job;
  } finally {
    isStartingDownloadQueue = false;
  }
}

function scheduleDownloadQueueProcessing() {
  // Um alarme pode disparar enquanto a chamada anterior ainda está aguardando
  // a API. Reutilizar a mesma Promise impede que dois loops consumam o mesmo
  // item da fila.
  if (!downloadQueueProcessor) {
    downloadQueueProcessor = processDownloadQueue().finally(() => {
      downloadQueueProcessor = undefined;
      // Uma nova fila pode ter sido criada no intervalo mínimo entre a fila
      // anterior terminar e esta Promise ser liberada. Retomamos somente se
      // ela ainda estiver pendente; nunca retomamos um item DOWNLOADING.
      void resumePendingDownloadQueue();
    });
  }
  return downloadQueueProcessor;
}

async function resumePendingDownloadQueue() {
  try {
    const job = await readDownloadJob();
    if (job?.status === 'RUNNING') void scheduleDownloadQueueProcessing();
  } catch (error) {
    console.warn('[BODEE] Não foi possível retomar a fila de downloads', safeMessage(error));
  }
}

async function processDownloadQueue() {
  while (true) {
    const job = await readDownloadJob();
    if (!job || job.status !== 'RUNNING') return;

    if (cancelledDownloadJobs.has(job.id)) {
      await finishDownloadQueueCancellation(job);
      return;
    }

    if (!(await downloadJobMatchesCurrentProfile(job))) {
      stopDownloadJobForLoginChange(job);
      await saveDownloadJob(job);
      await chrome.alarms.clear(downloadQueueAlarm);
      return;
    }

    // Se o worker for encerrado no meio de uma chamada, não é seguro repetir o
    // download: o Chrome pode já ter gravado o arquivo. Marcamos a ocorrência
    // para o usuário tentar somente aquele item, evitando duplicatas.
    const interruptedItems = job.items.filter((candidate) => candidate.status === 'DOWNLOADING');
    if (interruptedItems.length) {
      for (const interruptedItem of interruptedItems) {
        interruptedItem.status = 'FAILED';
        interruptedItem.error = 'Download interrompido antes da confirmação. Tente novamente este item.';
      }
      updateDownloadJobCounts(job);
      await saveDownloadJob(job);
      continue;
    }

    const item = job.items.find((candidate) => candidate.status === 'PENDING');
    if (!item) {
      job.status = 'COMPLETED';
      updateDownloadJobCounts(job);
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
        job.apiOrigin ?? API_ORIGIN,
      );
      item.status = 'COMPLETED';
      item.filename = result.filename;
    } catch (error) {
      item.status = 'FAILED';
      item.error = safeMessage(error);
    }
    updateDownloadJobCounts(job);
    if (cancelledDownloadJobs.has(job.id)) {
      await finishDownloadQueueCancellation(job);
      return;
    }
    await saveDownloadJob(job);
  }
}

async function cancelDownloadQueue() {
  const job = await readDownloadJob();
  if (!job || job.status !== 'RUNNING') return job;

  cancelledDownloadJobs.add(job.id);
  job.status = 'CANCELLED';
  for (const item of job.items) {
    if (item.status === 'PENDING') item.status = 'CANCELLED';
  }
  updateDownloadJobCounts(job);
  await saveDownloadJob(job);
  await chrome.alarms.clear(downloadQueueAlarm);
  return job;
}

async function finishDownloadQueueCancellation(job) {
  for (const item of job.items) {
    if (item.status === 'PENDING') item.status = 'CANCELLED';
  }
  job.status = 'CANCELLED';
  updateDownloadJobCounts(job);
  cancelledDownloadJobs.delete(job.id);
  await saveDownloadJob(job);
  await chrome.alarms.clear(downloadQueueAlarm);
}

function uniqueDownloadItems(downloads) {
  const seen = new Set();
  return downloads.filter((item) => {
    const key = `${item?.account}\u0000${item?.invoiceNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updateDownloadJobCounts(job) {
  job.total = job.items.length;
  job.complete = job.items.filter((item) => item.status === 'COMPLETED').length;
  job.failed = job.items.filter((item) => item.status === 'FAILED').length;
}

async function currentProfileKey(tabId) {
  const profile = await executeInPage(tabId, readPortalProfile).catch(() => undefined);
  return profileKey(profile);
}

async function downloadJobMatchesCurrentProfile(job) {
  // Filas iniciadas em versões anteriores não tinham esta identificação e
  // continuam com o comportamento já existente. As novas são interrompidas
  // se o portal passar a pertencer a outro login.
  if (!job.profileKey) return true;
  return job.profileKey === await currentProfileKey(job.portalTabId);
}

function stopDownloadJobForLoginChange(job) {
  for (const item of job.items) {
    if (item.status === 'PENDING' || item.status === 'DOWNLOADING') {
      item.status = 'FAILED';
      item.error = 'O login da Equatorial mudou durante a fila. Se necessário, inicie este download no login correto.';
    }
  }
  job.status = 'COMPLETED';
  updateDownloadJobCounts(job);
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
  const site = siteForPortalUrl(tab?.url);
  if (!tab?.id || !site) {
    if (!required) return undefined;
    throw new Error('Abra o portal da Equatorial e faça login antes de usar o BODEE.');
  }
  if (!new URL(tab.url).pathname.startsWith('/siteantigo')) {
    if (!required) return undefined;
    throw new Error('Abra o portal antigo da Equatorial antes de usar o BODEE.');
  }
  return { ...tab, apiOrigin: site.apiOrigin };
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
  if (result?.authenticated !== true) return { authenticated: false };
  return { authenticated: true, profileKey: await currentProfileKey(tabId) };
}

function profileKey(profile) {
  const holderName = typeof profile?.holderName === 'string' ? profile.holderName.trim().toLocaleLowerCase('pt-BR') : '';
  const accountIds = Array.isArray(profile?.accounts)
    ? profile.accounts.map((account) => account?.id).filter(Boolean).map(String).sort().join(',')
    : '';
  const loginRevision = typeof profile?.loginRevision === 'string' ? profile.loginRevision : '';
  // Não persiste token nem credenciais; é apenas uma impressão dos dados já
  // mostrados no popup para separar o cache visual de cada login.
  return holderName || accountIds || loginRevision ? `${holderName}|${accountIds}|${loginRevision}` : undefined;
}

function isPortalPageUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return Boolean(siteForPortalUrl(url.toString())) && url.pathname.startsWith('/siteantigo');
  } catch { return false; }
}

function siteForPortalUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const origin = new URL(value).origin;
    return EQUATORIAL_SITES.find((site) => site.portalOrigin === origin);
  } catch { return undefined; }
}

async function invalidatePopupCacheForCurrentLogin(tabId) {
  try {
    const current = await sessionStatus(tabId);
    if (!current.authenticated || !current.profileKey) return;
    const stored = await chrome.storage.session.get('bode.popup-state');
    const saved = stored['bode.popup-state'];
    if (saved?.accounts?.length && saved.profileKey !== current.profileKey) {
      await chrome.storage.session.remove('bode.popup-state');
    }
  } catch {
    // A navegação do portal pode finalizar antes dos dados da sessão; a
    // próxima abertura do popup fará a mesma validação sem exibir erro.
  }
}

async function accounts(tabId) {
  let result;
  try {
    result = await executeInPage(tabId, listAccountsFromPortal);
  } catch (error) {
    const diagnostic = { operation: 'units', status: 0, reason: `falha ao executar na página: ${safeMessage(error)}` };
    await saveDiagnostic(diagnostic);
    console.warn('[BODEE] Consulta de unidades falhou', diagnostic);
    throw new Error(`Não foi possível consultar as unidades consumidoras. ${formatDiagnostic(diagnostic)}`, { cause: error });
  }
  try {
    assertEquatorialSuccess(Number.isInteger(result?.status) ? result.status : 0, 'Não foi possível consultar as unidades consumidoras.');
  } catch (error) {
    const diagnostic = sanitizeDiagnostic(
      result?.diagnostic ?? { reason: 'a página não retornou o resultado da consulta' },
      Number.isInteger(result?.status) ? result.status : 0,
    );
    await saveDiagnostic(diagnostic);
    console.warn('[BODEE] Consulta de unidades falhou', diagnostic);
    throw new Error(`${safeMessage(error)} ${formatDiagnostic(diagnostic)}`, { cause: error });
  }
  const profile = await executeInPage(tabId, readPortalProfile);
  const profileAccounts = new Map((profile?.accounts || []).map((account) => [account.id, account]));
  const accounts = parseAccounts(result.body).map((account) => ({
    ...account,
    // A autenticação/JWT representa o titular da sessão atual e normalmente
    // contém nome e sobrenome; a lista de contas pode trazer apenas o primeiro nome.
    ...(profile?.holderName ? { holderName: profile.holderName } : {}),
    ...(profileAccounts.get(account.id)?.consumerUnitNumber
      ? { consumerUnitNumber: profileAccounts.get(account.id).consumerUnitNumber }
      : {}),
    ...(profileAccounts.get(account.id)?.installationNumber && !account.installationNumber
      ? { installationNumber: profileAccounts.get(account.id).installationNumber }
      : {}),
  }));
  if (accounts.length === 0) {
    const diagnostic = { operation: 'units', status: result?.status, response: 'lista sem unidades' };
    await saveDiagnostic(diagnostic);
    console.warn('[BODEE] Consulta de unidades sem resultado', diagnostic);
    throw new Error('A sessão está ativa, mas não retornou nenhuma unidade consumidora.');
  }
  await clearDiagnostic();
  return accounts;
}

async function readLastDiagnostic() {
  const stored = await chrome.storage.local.get(lastDiagnosticStorageKey);
  return stored[lastDiagnosticStorageKey];
}

async function saveDiagnostic(diagnostic) {
  await chrome.storage.local.set({ [lastDiagnosticStorageKey]: { ...diagnostic, occurredAt: new Date().toISOString() } });
}

async function clearDiagnostic() {
  await chrome.storage.local.remove(lastDiagnosticStorageKey);
}

function sanitizeDiagnostic(value, status) {
  const candidate = value && typeof value === 'object' ? value : {};
  return {
    operation: typeof candidate.operation === 'string' ? candidate.operation : 'units',
    status: Number.isInteger(candidate.status) ? candidate.status : status,
    ...(typeof candidate.contentType === 'string' ? { contentType: candidate.contentType.slice(0, 80) } : {}),
    ...(typeof candidate.response === 'string' ? { response: candidate.response.slice(0, 120) } : {}),
    ...(typeof candidate.reason === 'string' ? { reason: candidate.reason.slice(0, 80) } : {}),
  };
}

function formatDiagnostic(diagnostic) {
  const details = [
    diagnostic.status === 0 ? 'sem resposta HTTP' : `HTTP ${diagnostic.status}`,
    diagnostic.contentType,
    diagnostic.response,
    diagnostic.reason,
  ].filter(Boolean).join(' · ');
  return `(Diagnóstico BODEE: unidades; ${details || 'sem detalhes'}.)`;
}

async function invoices(tabId, account, openOnly = false, apiOrigin = API_ORIGIN) {
  const url = new URL(`/api/v1/debitos/${encodeURIComponent(requireText(account))}`, apiOrigin);
  url.searchParams.set('listarEmAberto', String(openOnly));
  const result = await requestWithCurrentSession(tabId, url.toString(), apiOrigin);
  // Para contas sem débitos/faturas, a Equatorial pode responder 404 em vez
  // de uma lista vazia. Isso é um resultado válido e não deve derrubar as
  // consultas das demais contas selecionadas.
  if (result.status === 404) return [];
  assertEquatorialSuccess(result.status, 'Não foi possível consultar as faturas.');
  return parseInvoices(result.body);
}

async function download(tabId, account, holderName, consumerUnitNumber, invoiceNumber, competence, apiOrigin = API_ORIGIN) {
  const url = new URL(`/api/v1/faturas/segunda-via/${encodeURIComponent(requireText(invoiceNumber))}`, apiOrigin);
  url.searchParams.set('contaContrato', requireText(account));
  const result = await requestWithCurrentSession(tabId, url.toString(), apiOrigin);
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

async function downloadBatch(tabId, downloads, apiOrigin = API_ORIGIN) {
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
        apiOrigin,
      );
      complete += 1;
    } catch {
      failed += 1;
    }
  }
  return { complete, failed };
}

async function requestWithCurrentSession(portalTabId, requestUrl, apiOrigin = API_ORIGIN) {
  let accessToken;
  let apiTabId;
  try {
    accessToken = await executeInPage(portalTabId, readAccessTokenForRequest);
    if (!accessToken) throw new Error('A sessão da Equatorial não está autenticada. Faça login novamente.');

    const apiTab = await chrome.tabs.create({ url: apiOrigin, active: false });
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
