/* global chrome, document */
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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[downloadJobStorageKey]) renderDownloadJob(changes[downloadJobStorageKey].newValue);
  if (area === 'session' && changes[popupStateStorageKey]?.newValue === undefined) void refreshStatus();
});
void initializePopup();

async function initializePopup() {
  const stored = await chrome.storage.session.get(downloadQueueMinimizedStorageKey);
  downloadQueueMinimized = stored[downloadQueueMinimizedStorageKey] === true;
  await refreshStatus();
}

async function refreshStatus() {
  try {
    const result = await request('bode.status');
    if (result.authenticated) {
      activeProfileKey = result.profileKey;
      status.textContent = '● Sessão conectada'; status.className = 'status connected'; loadAccounts.disabled = false;
      openPortal.hidden = true;
      if (!(await restorePopupState(result.profileKey))) void refreshAccounts();
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
    const results = await Promise.all(selectedAccounts.map(async (account) => [
      account,
      await request('bode.invoices', { account, openOnly }),
    ]));
    if (selectedAccounts.join() !== checkedValues(accounts).join() || openOnly !== openInvoicesOnly.checked) return;
    invoicesByAccount = new Map(results); const competences = renderInvoices(results, selectedAccounts);
    if (!competences.length) showMessage(
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
    const place = formatAccountPlace(item.address, item.city);
    const accountDescription = item.consumerUnitNumber ? `UC ${item.consumerUnitNumber} — Conta ${item.id}` : `Conta ${item.id}`;
    const description = [item.holderName, accountDescription, place].filter(Boolean).join(' — ');
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
  const isComplete = job.status !== 'RUNNING' && !job.failed;
  downloadProgress.classList.toggle('is-complete', isComplete);
  downloadQueueNote.hidden = job.status !== 'RUNNING';
  setDownloadQueueMinimized(job.status === 'RUNNING' && downloadQueueMinimized);
  if (job.status === 'RUNNING') updateDownloadProgress(processed, job.total);
  else downloadProgress.hidden = false;
  renderDownloadQueueItems(job.items);
  if (job.status === 'RUNNING') {
    downloadProgressLabel.textContent = `Baixando faturas (${job.items.find((item) => item.status === 'DOWNLOADING')?.competence || 'aguardando'})`;
    clearMessage();
  } else {
    const unavailableMessage = job.unavailable ? ` ${job.unavailable} combinação(ões) sem fatura foram ignoradas.` : '';
    const failureMessage = job.failed ? ` ${job.failed} falharam.` : '';
    downloadProgressLabel.textContent = job.failed ? 'Download concluído com pendências' : 'Download concluído';
    const downloadedMessage = `${job.complete} ${job.complete === 1 ? 'fatura baixada' : 'faturas baixadas'}.`;
    showMessage(`${downloadedMessage}${unavailableMessage}${failureMessage}`, job.failed ? 'error' : 'success');
  }
  updateButtons();
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
async function request(type, payload = {}) { const response = await chrome.runtime.sendMessage({ type, ...payload }); if (!response?.ok) throw new Error(response?.error || 'Falha inesperada.'); return response.value; }
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
