/* global chrome, document */
import { queryInvoicesByAccount } from './invoice-query.js';

const MOCK_MODE = globalThis.__BODEE_MOCK_MODE__ === true;
let mockRequest;
const status = document.querySelector('#session-status');
const openPortal = document.querySelector('#open-portal');
const loadAccounts = document.querySelector('#load-accounts');
const invoiceSection = document.querySelector('#invoices-section');
const accounts = document.querySelector('#accounts');
const accountSearch = document.querySelector('#account-search');
const invoices = document.querySelector('#invoices');
const openInvoicesOnly = document.querySelector('#open-invoices-only');
const selectAllAccounts = document.querySelector('#select-all-accounts');
const selectAllInvoices = document.querySelector('#select-all-invoices');
const accountsContent = document.querySelector('#accounts-content');
const invoicesContent = document.querySelector('#invoices-content');
const accountHolder = document.querySelector('#account-holder');
const accountsToggle = document.querySelector('#accounts-toggle');
const invoicesToggle = document.querySelector('#invoices-toggle');
const selectedAccountsCount = document.querySelector('#selected-accounts-count');
const selectedInvoicesCount = document.querySelector('#selected-invoices-count');
const download = document.querySelector('#download');
const downloadProgress = document.querySelector('#download-progress');
const downloadProgressLabel = document.querySelector('#download-progress-label');
const downloadProgressCount = document.querySelector('#download-progress-count');
const downloadProgressBar = document.querySelector('#download-progress-bar');
const downloadQueueItems = document.querySelector('#download-queue-items');
const downloadQueueToggle = document.querySelector('#download-queue-toggle');
const downloadQueueNote = document.querySelector('#download-queue-note');
const downloadQueueCancel = document.querySelector('#download-queue-cancel');
const message = document.querySelector('#message');
const popupStateStorageKey = 'bode.popup-state';
const downloadJobStorageKey = 'bode.download-job';
const downloadQueueMinimizedStorageKey = 'bode.download-queue-minimized';
let invoicesByAccount = new Map();
let accountsById = new Map();
let downloadJob;
let downloadQueueMinimized = false;
let activeProfileKey;

loadAccounts.addEventListener('click', () => void refreshAccounts(true));
openPortal.addEventListener('click', () => void request('bode.open-portal'));
accounts.addEventListener('change', () => void refreshInvoices());
accountSearch.addEventListener('input', filterAccounts);
invoices.addEventListener('change', () => { updateDownloadButton(); void persistPopupState(); });
openInvoicesOnly.addEventListener('change', () => void refreshInvoices());
selectAllAccounts.addEventListener('click', () => {
  toggleAll(accounts);
  void refreshInvoices();
});
selectAllInvoices.addEventListener('click', () => {
  toggleAll(invoices);
  updateDownloadButton();
  void persistPopupState();
});
accountsToggle.addEventListener('click', () => toggleSection(accountsToggle, accountsContent, 'unidades'));
invoicesToggle.addEventListener('click', () => toggleSection(invoicesToggle, invoicesContent, 'competências'));
download.addEventListener('click', () => void downloadSelected());
downloadQueueToggle.addEventListener('click', () => void toggleDownloadQueue());
downloadQueueCancel.addEventListener('click', () => void cancelDownloadQueue());
downloadQueueItems.addEventListener('click', (event) => {
  const button = event.target.closest('[data-retry-item]');
  if (button) void retryDownloadItem(button.dataset.retryItem, button);
});
if (!MOCK_MODE) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[downloadJobStorageKey]) renderDownloadJob(changes[downloadJobStorageKey].newValue);
    if (area === 'session' && changes[popupStateStorageKey]?.newValue === undefined) void refreshStatus();
  });
}
void initializePopup();

async function initializePopup() {
  if (MOCK_MODE) {
    ({ mockRequest } = await import('./popup-mock.js'));
    await initializeMockPopup();
    return;
  }
  const stored = await chrome.storage.session.get(downloadQueueMinimizedStorageKey);
  downloadQueueMinimized = stored[downloadQueueMinimizedStorageKey] === true;
  await refreshStatus();
}

async function initializeMockPopup() {
  setCompactPopup(false);
  const mockStatus = await request('bode.status');
  activeProfileKey = mockStatus.profileKey;
  status.textContent = '● Modo de teste local'; status.className = 'status connected'; loadAccounts.disabled = false;
  renderAccounts(await request('bode.accounts'), new Set(['452643701343']));
  invoiceSection.hidden = false;
  await refreshInvoices();
  for (const checkbox of [...invoices.querySelectorAll('input')].slice(0, 3)) checkbox.checked = true;
  updateButtons();
  renderDownloadJob(await request('bode.download-status'));
  showMessage('Dados simulados localmente: nenhuma chamada à Equatorial será feita.', 'success');
}

async function refreshStatus() {
  try {
    const result = await request('bode.status');
    if (result.authenticated) {
      setCompactPopup(false);
      activeProfileKey = result.profileKey;
      status.textContent = '● Sessão conectada'; status.className = 'status connected'; loadAccounts.disabled = false;
      openPortal.hidden = true;
      if (!(await restorePopupState(result.profileKey))) void refreshAccounts();
      renderDownloadJob(await request('bode.download-status'));
      return;
    }
    setCompactPopup(true);
    status.textContent = 'Faça login no portal da Equatorial para suas contas aparecerem.'; status.className = 'status disconnected'; loadAccounts.disabled = true;
    openPortal.hidden = false;
  } catch (error) {
    setCompactPopup(true);
    status.textContent = 'Não foi possível verificar a sessão da Equatorial.'; status.className = 'status disconnected'; openPortal.hidden = false;
    showMessage(error.message, 'error');
  }
}

function setCompactPopup(compact) {
  document.documentElement.classList.toggle('compact-popup', compact);
}

async function refreshAccounts(refreshProfile = false) {
  setBusy(loadAccounts, true); clearMessage();
  try {
    if (refreshProfile) activeProfileKey = (await request('bode.status')).profileKey;
    const availableAccounts = await request('bode.accounts');
    renderAccounts(availableAccounts);
    invoices.replaceChildren(); invoicesByAccount = new Map();
    invoiceSection.hidden = false; updateButtons();
    await persistPopupState();
  } catch (error) { showMessage(error.message, 'error'); }
  finally { setBusy(loadAccounts, false); }
}

async function refreshInvoices() {
  const selectedAccounts = checkedValues(accounts);
  const openOnly = openInvoicesOnly.checked;
  invoices.replaceChildren(); invoicesByAccount = new Map(); clearMessage();
  if (!selectedAccounts.length) { updateButtons(); await persistPopupState(); return; }

  try {
    openInvoicesOnly.disabled = true;
    const { results, failures } = await queryInvoicesByAccount(
      selectedAccounts,
      (account) => request('bode.invoices', { account, openOnly }),
    );
    if (selectedAccounts.join() !== checkedValues(accounts).join() || openOnly !== openInvoicesOnly.checked) return;
    invoicesByAccount = new Map(results); const competences = renderInvoices(results, selectedAccounts);
    if (failures.length === selectedAccounts.length) {
      const firstError = failures[0]?.error;
      showMessage(firstError instanceof Error ? firstError.message : 'Não foi possível consultar as faturas.', 'error');
    } else if (failures.length) {
      const label = failures.length === 1 ? '1 unidade não pôde ser consultada' : `${failures.length} unidades não puderam ser consultadas`;
      showMessage(`${label}; as demais foram carregadas normalmente.`, 'error');
    } else if (!competences.length) showMessage(
      openOnly
        ? 'Nenhuma fatura em aberto para as unidades selecionadas.'
        : 'Nenhuma fatura disponível para as unidades selecionadas.',
      'error',
    );
  } catch (error) { showMessage(error.message, 'error'); }
  finally { openInvoicesOnly.disabled = false; updateButtons(); await persistPopupState(); }
}

async function downloadSelected() {
  const selectedAccounts = checkedValues(accounts);
  const selectedCompetences = checkedValues(invoices);
  const items = selectedAccounts.flatMap((account) => selectedCompetences.flatMap((competence) => {
    const invoice = invoicesByAccount.get(account)?.find((item) => item.competence === competence);
    return invoice?.available !== false ? (invoice ? [{ account, invoice }] : []) : [];
  }));
  const unavailable = selectedAccounts.length * selectedCompetences.length - items.length;
  if (!items.length) {
    showMessage('As faturas selecionadas ainda não estão disponíveis para download.', 'error');
    return;
  }

  download.disabled = true; clearMessage();
  const downloads = items.map(({ account, invoice }) => ({
    account,
    holderName: accountsById.get(account)?.holderName,
    consumerUnitNumber: accountsById.get(account)?.consumerUnitNumber,
    invoiceNumber: invoice.invoiceNumber,
    competence: invoice.competence,
  }));
  try {
    const job = await request('bode.download-queue', { downloads });
    job.unavailable = unavailable;
    renderDownloadJob(job);
  } catch (error) { showMessage(error.message, 'error'); updateButtons(); }
}

function renderAccounts(availableAccounts, selectedAccounts = new Set()) {
  accounts.replaceChildren(); accountsById = new Map(); accountSearch.value = '';
  const holderNames = [...new Set(availableAccounts
    .map((item) => typeof item.holderName === 'string' ? item.holderName.trim() : '')
    .filter(Boolean))];
  accountHolder.textContent = holderNames.join(' · ');
  accountHolder.hidden = holderNames.length === 0;
  for (const item of availableAccounts) {
    const place = formatAccountPlace(item.address, item.city);
    const accountDescription = item.consumerUnitNumber ? `UC ${item.consumerUnitNumber}` : undefined;
    const description = [accountDescription, item.id ? `C ${item.id}` : undefined, place].filter(Boolean).join(' - ');
    const label = document.createElement('label'); label.className = 'choice';
    label.dataset.search = normalizeSearch([item.holderName, item.consumerUnitNumber, item.id, item.address, item.city].filter(Boolean).join(' '));
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.id; checkbox.checked = selectedAccounts.has(item.id);
    label.append(checkbox, document.createTextNode(description)); accounts.append(label); accountsById.set(item.id, item);
  }
}

function formatAccountPlace(address, city) {
  const meaningfulText = (value) => {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    // O portal às vezes devolve apenas "A" como endereço. Sem rua, número ou
    // bairro, isso não identifica a unidade e só polui o rótulo.
    return text.length > 1 ? text : undefined;
  };
  return [meaningfulText(address), meaningfulText(city)].filter(Boolean).join(' — ');
}

function renderInvoices(results, selectedAccounts, selectedCompetences = new Set()) {
  invoices.replaceChildren();
  const competences = [...new Set(results.flatMap(([, availableInvoices]) => availableInvoices.map((invoice) => invoice.competence)))].sort().reverse();
  for (const competence of competences) {
    const availableFor = results.filter(([, availableInvoices]) => availableInvoices.some((invoice) => invoice.competence === competence)).length;
    const label = document.createElement('label'); label.className = 'invoice';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = competence; checkbox.checked = selectedCompetences.has(competence);
    const availability = availableFor === selectedAccounts.length ? '' : ` (${availableFor}/${selectedAccounts.length} unidades)`;
    label.append(checkbox, document.createTextNode(`${competence}${availability}`)); invoices.append(label);
  }
  return competences;
}

async function restorePopupState(profileKey) {
  const stored = await chrome.storage.session.get(popupStateStorageKey);
  const saved = stored[popupStateStorageKey];
  // As unidades e faturas em memória pertencem ao login que as consultou.
  // Ao trocar de titular, ignoramos esse cache e recarregamos os dados atuais.
  if (!profileKey || !saved?.accounts?.length || saved.profileKey !== profileKey) return false;
  renderAccounts(saved.accounts, new Set(saved.selectedAccounts));
  openInvoicesOnly.checked = saved.openOnly === true;
  invoicesByAccount = new Map(saved.invoicesByAccount || []);
  renderInvoices([...invoicesByAccount], saved.selectedAccounts || [], new Set(saved.selectedCompetences));
  invoiceSection.hidden = false; updateButtons();
  return true;
}

async function persistPopupState() {
  if (MOCK_MODE) return;
  await chrome.storage.session.set({
    [popupStateStorageKey]: {
      accounts: [...accountsById.values()], selectedAccounts: checkedValues(accounts),
      invoicesByAccount: [...invoicesByAccount], selectedCompetences: checkedValues(invoices),
      openOnly: openInvoicesOnly.checked,
      profileKey: activeProfileKey,
    },
  });
}

function renderDownloadJob(job) {
  downloadJob = job;
  if (!job) { downloadProgress.hidden = true; downloadQueueNote.hidden = true; downloadProgress.classList.remove('is-complete'); downloadQueueItems.replaceChildren(); updateButtons(); return; }
  const processed = job.complete + job.failed;
  const isComplete = job.status === 'COMPLETED' && !job.failed;
  downloadProgress.classList.toggle('is-complete', isComplete);
  downloadQueueNote.hidden = job.status !== 'RUNNING';
  downloadQueueCancel.disabled = job.status !== 'RUNNING';
  setDownloadQueueMinimized(job.status === 'RUNNING' && downloadQueueMinimized);
  if (job.status === 'RUNNING') updateDownloadProgress(processed, job.total);
  else downloadProgress.hidden = false;
  renderDownloadQueueItems(job.items);
  if (job.status === 'RUNNING') {
    downloadProgressLabel.textContent = `Baixando faturas (${job.items.find((item) => item.status === 'DOWNLOADING')?.competence || 'aguardando'})`;
    clearMessage();
  } else if (job.status === 'CANCELLED') {
    downloadProgressLabel.textContent = 'Download cancelado';
    showMessage(`${job.complete} ${job.complete === 1 ? 'fatura foi baixada' : 'faturas foram baixadas'} antes do cancelamento.`, 'error');
  } else {
    const unavailableMessage = job.unavailable ? ` ${job.unavailable} combinação(ões) sem fatura foram ignoradas.` : '';
    const failureMessage = job.failed ? ` ${job.failed} falharam.` : '';
    downloadProgressLabel.textContent = job.failed ? 'Download concluído com pendências' : 'Download concluído';
    const downloadedMessage = `${job.complete} ${job.complete === 1 ? 'fatura baixada' : 'faturas baixadas'}.`;
    showMessage(`${downloadedMessage}${unavailableMessage}${failureMessage}`, job.failed ? 'error' : 'success');
  }
  updateButtons();
}

async function cancelDownloadQueue() {
  downloadQueueCancel.disabled = true;
  try {
    renderDownloadJob(await request('bode.download-cancel'));
  } catch (error) {
    showMessage(error.message, 'error');
    downloadQueueCancel.disabled = false;
  }
}

async function retryDownloadItem(itemId, button) {
  button.disabled = true;
  button.textContent = 'Tentando…';
  try {
    renderDownloadJob(await request('bode.download-retry', { itemId }));
  } catch (error) {
    showMessage(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Tente novamente';
  }
}

function setDownloadQueueMinimized(minimized) {
  downloadProgress.classList.toggle('is-minimized', minimized);
  const action = minimized ? 'Expandir' : 'Minimizar';
  downloadQueueToggle.setAttribute('aria-expanded', String(!minimized));
  downloadQueueToggle.setAttribute('aria-label', `${action} fila`);
  downloadQueueToggle.title = `${action} fila`;
}

async function toggleDownloadQueue() {
  downloadQueueMinimized = !downloadQueueMinimized;
  setDownloadQueueMinimized(downloadQueueMinimized);
  if (MOCK_MODE) return;
  await chrome.storage.session.set({ [downloadQueueMinimizedStorageKey]: downloadQueueMinimized });
}

function toggleSection(toggle, content, name) {
  const minimized = !content.hidden;
  content.hidden = minimized;
  toggle.setAttribute('aria-expanded', String(!minimized));
  const action = minimized ? 'Expandir' : 'Minimizar';
  toggle.setAttribute('aria-label', `${action} ${name}`);
  toggle.title = `${action} ${name}`;
}

function renderDownloadQueueItems(items) {
  const statusLabels = { PENDING: 'Na fila', DOWNLOADING: 'Baixando', COMPLETED: 'Baixada', FAILED: 'Erro', CANCELLED: 'Cancelada' };
  downloadQueueItems.replaceChildren();
  for (const item of items) {
    const label = [item.consumerUnitNumber ? `UC ${item.consumerUnitNumber}` : `Conta ${item.account}`, item.competence].join(' — ');
    const row = document.createElement('li');
    const name = document.createElement('span'); name.textContent = label;
    const state = document.createElement('span'); state.className = `queue-status ${item.status === 'FAILED' ? 'failed' : ''}`;
    state.textContent = statusLabels[item.status];
    if (item.status === 'FAILED' && item.error) { state.title = item.error; state.setAttribute('aria-label', `Erro: ${item.error}`); }
    row.append(name, state);
    if (item.status === 'FAILED') {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button queue-retry';
      retry.textContent = 'Tente novamente'; retry.dataset.retryItem = item.id; retry.setAttribute('aria-label', `Tentar novamente ${label}`);
      row.append(retry);
    }
    downloadQueueItems.append(row);
  }
}

function filterAccounts() {
  const query = normalizeSearch(accountSearch.value);
  for (const choice of accounts.querySelectorAll('.choice')) {
    choice.hidden = Boolean(query) && !choice.dataset.search.includes(query);
  }
}

function checkedValues(container) { return [...container.querySelectorAll('input:checked')].map((input) => input.value); }
function normalizeSearch(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function toggleAll(container) {
  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')]
    .filter((checkbox) => container !== accounts || !checkbox.closest('.choice').hidden);
  const shouldSelectAll = [...checkboxes].some((checkbox) => !checkbox.checked);
  for (const checkbox of checkboxes) checkbox.checked = shouldSelectAll;
}
function updateButtons() {
  updateToggleLabel(selectAllAccounts, accounts);
  updateToggleLabel(selectAllInvoices, invoices);
  updateSelectedCount(selectedAccountsCount, checkedValues(accounts).length);
  updateSelectedCount(selectedInvoicesCount, checkedValues(invoices).length);
  updateDownloadButton();
}
function updateSelectedCount(element, count) { element.textContent = count ? `(${count})` : ''; }
function updateToggleLabel(button, container) {
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  button.textContent = checkboxes.length && [...checkboxes].every((checkbox) => checkbox.checked) ? 'Nenhuma' : 'Todas';
}
function updateDownloadButton() { download.disabled = downloadJob?.status === 'RUNNING' || !checkedValues(accounts).length || !checkedValues(invoices).length; }
async function request(type, payload = {}) {
  if (MOCK_MODE) return mockRequest(type, payload);
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Falha inesperada.');
  return response.value;
}
function updateDownloadProgress(current, total) {
  downloadProgress.hidden = false;
  downloadProgress.classList.remove('is-complete');
  downloadProgressCount.textContent = `${current}/${total}`;
  downloadProgressBar.max = total;
  downloadProgressBar.value = current;
}
function setBusy(button, busy) { button.disabled = busy; button.classList.toggle('is-loading', busy); }
function showMessage(text, type) { message.textContent = text; message.className = `message ${type}`; }
function clearMessage() { message.textContent = ''; message.className = 'message'; }
