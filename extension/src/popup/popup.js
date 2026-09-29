/* global chrome, document */
const status = document.querySelector('#session-status');
const openPortal = document.querySelector('#open-portal');
const loadAccounts = document.querySelector('#load-accounts');
const invoiceSection = document.querySelector('#invoices-section');
const accounts = document.querySelector('#accounts');
const accountSearch = document.querySelector('#account-search');
const invoices = document.querySelector('#invoices');
const selectAllAccounts = document.querySelector('#select-all-accounts');
const selectAllInvoices = document.querySelector('#select-all-invoices');
const download = document.querySelector('#download');
const downloadProgress = document.querySelector('#download-progress');
const downloadProgressLabel = document.querySelector('#download-progress-label');
const downloadProgressCount = document.querySelector('#download-progress-count');
const downloadProgressBar = document.querySelector('#download-progress-bar');
const downloadQueueItems = document.querySelector('#download-queue-items');
const message = document.querySelector('#message');
const popupStateStorageKey = 'bode.popup-state';
const downloadJobStorageKey = 'bode.download-job';
let invoicesByAccount = new Map();
let accountsById = new Map();
let downloadJob;

loadAccounts.addEventListener('click', () => void refreshAccounts());
openPortal.addEventListener('click', () => void request('bode.open-portal'));
accounts.addEventListener('change', () => void refreshInvoices());
accountSearch.addEventListener('input', filterAccounts);
invoices.addEventListener('change', () => { updateDownloadButton(); void persistPopupState(); });
selectAllAccounts.addEventListener('click', () => {
  toggleAll(accounts);
  void refreshInvoices();
});
selectAllInvoices.addEventListener('click', () => {
  toggleAll(invoices);
  updateDownloadButton();
  void persistPopupState();
});
download.addEventListener('click', () => void downloadSelected());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[downloadJobStorageKey]) renderDownloadJob(changes[downloadJobStorageKey].newValue);
});
void refreshStatus();

async function refreshStatus() {
  try {
    const result = await request('bode.status');
    if (result.authenticated) {
      status.textContent = '● Sessão conectada'; status.className = 'status connected'; loadAccounts.disabled = false;
      openPortal.hidden = true;
      if (!(await restorePopupState())) void refreshAccounts();
      renderDownloadJob(await request('bode.download-status'));
      return;
    }
    status.textContent = 'Você ainda não está conectado à Equatorial.'; status.className = 'status disconnected'; loadAccounts.disabled = true;
    openPortal.hidden = false;
  } catch (error) {
    status.textContent = 'Não foi possível verificar a sessão da Equatorial.'; status.className = 'status disconnected'; openPortal.hidden = false;
    showMessage(error.message, 'error');
  }
}

async function refreshAccounts() {
  setBusy(loadAccounts, true); clearMessage();
  try {
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
  invoices.replaceChildren(); invoicesByAccount = new Map(); clearMessage();
  if (!selectedAccounts.length) { updateButtons(); await persistPopupState(); return; }

  try {
    const results = await Promise.all(selectedAccounts.map(async (account) => [account, await request('bode.invoices', { account })]));
    if (selectedAccounts.join() !== checkedValues(accounts).join()) return;
    invoicesByAccount = new Map(results); const competences = renderInvoices(results, selectedAccounts);
    if (!competences.length) showMessage('Nenhuma fatura disponível para as unidades selecionadas.', 'error');
  } catch (error) { showMessage(error.message, 'error'); }
  finally { updateButtons(); await persistPopupState(); }
}

async function downloadSelected() {
  const selectedAccounts = checkedValues(accounts);
  const selectedCompetences = checkedValues(invoices);
  const items = selectedAccounts.flatMap((account) => selectedCompetences.flatMap((competence) => {
    const invoice = invoicesByAccount.get(account)?.find((item) => item.competence === competence);
    return invoice ? [{ account, invoice }] : [];
  }));
  const unavailable = selectedAccounts.length * selectedCompetences.length - items.length;
  if (!items.length) return;

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
  for (const item of availableAccounts) {
    const place = [item.address, item.city].filter(Boolean).join(' — ');
    const accountDescription = item.consumerUnitNumber ? `UC ${item.consumerUnitNumber} — Conta ${item.id}` : `Conta ${item.id}`;
    const description = [item.holderName, accountDescription, place].filter(Boolean).join(' — ');
    const label = document.createElement('label'); label.className = 'choice';
    label.dataset.search = normalizeSearch([item.holderName, item.consumerUnitNumber, item.id, item.address, item.city].filter(Boolean).join(' '));
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.id; checkbox.checked = selectedAccounts.has(item.id);
    label.append(checkbox, document.createTextNode(description)); accounts.append(label); accountsById.set(item.id, item);
  }
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

async function restorePopupState() {
  const stored = await chrome.storage.session.get(popupStateStorageKey);
  const saved = stored[popupStateStorageKey];
  if (!saved?.accounts?.length) return false;
  renderAccounts(saved.accounts, new Set(saved.selectedAccounts));
  invoicesByAccount = new Map(saved.invoicesByAccount || []);
  renderInvoices([...invoicesByAccount], saved.selectedAccounts || [], new Set(saved.selectedCompetences));
  invoiceSection.hidden = false; updateButtons();
  return true;
}

async function persistPopupState() {
  await chrome.storage.session.set({
    [popupStateStorageKey]: {
      accounts: [...accountsById.values()], selectedAccounts: checkedValues(accounts),
      invoicesByAccount: [...invoicesByAccount], selectedCompetences: checkedValues(invoices),
    },
  });
}

function renderDownloadJob(job) {
  downloadJob = job;
  if (!job) { downloadQueueItems.replaceChildren(); updateButtons(); return; }
  const processed = job.complete + job.failed;
  updateDownloadProgress(processed, job.total);
  renderDownloadQueueItems(job.items);
  if (job.status === 'RUNNING') {
    downloadProgressLabel.textContent = `Baixando faturas (${job.items.find((item) => item.status === 'DOWNLOADING')?.competence || 'aguardando'})`;
    showMessage(`${processed}/${job.total} faturas processadas. A fila continua mesmo se você fechar o popup.`, 'success');
  } else {
    const unavailableMessage = job.unavailable ? ` ${job.unavailable} combinação(ões) sem fatura foram ignoradas.` : '';
    const failureMessage = job.failed ? ` ${job.failed} falharam.` : '';
    downloadProgressLabel.textContent = job.failed ? 'Download concluído com pendências' : 'Download concluído';
    showMessage(`${job.complete}/${job.total} faturas baixadas.${unavailableMessage}${failureMessage}`, job.failed ? 'error' : 'success');
  }
  updateButtons();
}

function renderDownloadQueueItems(items) {
  const statusLabels = { PENDING: 'Na fila', DOWNLOADING: 'Baixando', COMPLETED: 'Baixada', FAILED: 'Falhou' };
  downloadQueueItems.replaceChildren();
  for (const item of items) {
    const label = [item.consumerUnitNumber ? `UC ${item.consumerUnitNumber}` : `Conta ${item.account}`, item.competence].join(' — ');
    const row = document.createElement('li');
    const name = document.createElement('span'); name.textContent = label;
    const state = document.createElement('span'); state.className = `queue-status ${item.status === 'FAILED' ? 'failed' : ''}`;
    state.textContent = item.status === 'FAILED' && item.error ? `${statusLabels[item.status]}: ${item.error}` : statusLabels[item.status];
    row.append(name, state); downloadQueueItems.append(row);
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
  updateDownloadButton();
}
function updateToggleLabel(button, container) {
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  button.textContent = checkboxes.length && [...checkboxes].every((checkbox) => checkbox.checked) ? 'Nenhuma' : 'Todas';
}
function updateDownloadButton() { download.disabled = downloadJob?.status === 'RUNNING' || !checkedValues(accounts).length || !checkedValues(invoices).length; }
async function request(type, payload = {}) { const response = await chrome.runtime.sendMessage({ type, ...payload }); if (!response?.ok) throw new Error(response?.error || 'Falha inesperada.'); return response.value; }
function updateDownloadProgress(current, total) {
  downloadProgress.hidden = false;
  downloadProgressCount.textContent = `${current}/${total}`;
  downloadProgressBar.max = total;
  downloadProgressBar.value = current;
}
function setBusy(button, busy) { button.disabled = busy; button.classList.toggle('is-loading', busy); }
function showMessage(text, type) { message.textContent = text; message.className = `message ${type}`; }
function clearMessage() { message.textContent = ''; message.className = 'message'; }
