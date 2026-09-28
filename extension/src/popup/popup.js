/* global chrome, document */
const status = document.querySelector('#session-status');
const openPortal = document.querySelector('#open-portal');
const loadAccounts = document.querySelector('#load-accounts');
const invoiceSection = document.querySelector('#invoices-section');
const accounts = document.querySelector('#accounts');
const invoices = document.querySelector('#invoices');
const selectAllAccounts = document.querySelector('#select-all-accounts');
const selectAllInvoices = document.querySelector('#select-all-invoices');
const download = document.querySelector('#download');
const message = document.querySelector('#message');
let invoicesByAccount = new Map();
let accountsById = new Map();

loadAccounts.addEventListener('click', () => void refreshAccounts());
openPortal.addEventListener('click', () => void request('bode.open-portal'));
accounts.addEventListener('change', () => void refreshInvoices());
invoices.addEventListener('change', updateDownloadButton);
selectAllAccounts.addEventListener('click', () => {
  toggleAll(accounts);
  void refreshInvoices();
});
selectAllInvoices.addEventListener('click', () => {
  toggleAll(invoices);
  updateDownloadButton();
});
download.addEventListener('click', () => void downloadSelected());
void refreshStatus();

async function refreshStatus() {
  try {
    const result = await request('bode.status');
    if (result.authenticated) {
      status.textContent = '● Sessão conectada'; status.className = 'status connected'; loadAccounts.disabled = false;
      openPortal.hidden = true;
      void refreshAccounts();
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
  setBusy(loadAccounts, true, 'CARREGANDO…'); clearMessage();
  try {
    const availableAccounts = await request('bode.accounts');
    accounts.replaceChildren(); invoices.replaceChildren(); invoicesByAccount = new Map(); accountsById = new Map();
    for (const item of availableAccounts) {
      const place = [item.address, item.city].filter(Boolean).join(' — ');
      const accountDescription = item.consumerUnitNumber
        ? `UC ${item.consumerUnitNumber} — Conta ${item.id}`
        : `Conta ${item.id}`;
      const description = [item.holderName, accountDescription, place].filter(Boolean).join(' — ');
      const label = document.createElement('label'); label.className = 'choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.id;
      label.append(checkbox, document.createTextNode(description)); accounts.append(label);
      accountsById.set(item.id, item);
    }
    invoiceSection.hidden = false; updateButtons();
  } catch (error) { showMessage(error.message, 'error'); }
  finally { setBusy(loadAccounts, false, 'ATUALIZAR UNIDADES'); }
}

async function refreshInvoices() {
  const selectedAccounts = checkedValues(accounts);
  invoices.replaceChildren(); invoicesByAccount = new Map(); clearMessage();
  if (!selectedAccounts.length) { updateButtons(); return; }

  try {
    const results = await Promise.all(selectedAccounts.map(async (account) => [account, await request('bode.invoices', { account })]));
    if (selectedAccounts.join() !== checkedValues(accounts).join()) return;
    invoicesByAccount = new Map(results);
    const competences = [...new Set(results.flatMap(([, availableInvoices]) => availableInvoices.map((invoice) => invoice.competence)))].sort().reverse();
    for (const competence of competences) {
      const availableFor = results.filter(([, availableInvoices]) => availableInvoices.some((invoice) => invoice.competence === competence)).length;
      const label = document.createElement('label'); label.className = 'invoice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = competence;
      const availability = availableFor === selectedAccounts.length ? '' : ` (${availableFor}/${selectedAccounts.length} unidades)`;
      label.append(checkbox, document.createTextNode(`${competence}${availability}`)); invoices.append(label);
    }
    if (!competences.length) showMessage('Nenhuma fatura disponível para as unidades selecionadas.', 'error');
  } catch (error) { showMessage(error.message, 'error'); }
  finally { updateButtons(); }
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
    const result = await request('bode.download-batch', { downloads });
    const unavailableMessage = unavailable ? ` ${unavailable} combinação(ões) sem fatura foram ignoradas.` : '';
    const failureMessage = result.failed ? ` ${result.failed} falharam.` : '';
    showMessage(`${result.complete}/${items.length} faturas baixadas.${unavailableMessage}${failureMessage}`, result.failed ? 'error' : 'success');
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    updateButtons();
  }
}

function checkedValues(container) { return [...container.querySelectorAll('input:checked')].map((input) => input.value); }
function toggleAll(container) {
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
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
function updateDownloadButton() { download.disabled = !checkedValues(accounts).length || !checkedValues(invoices).length; }
async function request(type, payload = {}) { const response = await chrome.runtime.sendMessage({ type, ...payload }); if (!response?.ok) throw new Error(response?.error || 'Falha inesperada.'); return response.value; }
function setBusy(button, busy, label) { button.disabled = busy; button.textContent = label; }
function showMessage(text, type) { message.textContent = text; message.className = `message ${type}`; }
function clearMessage() { message.textContent = ''; message.className = 'message'; }
