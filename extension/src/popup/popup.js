/* global chrome, document */
const status = document.querySelector('#session-status');
const loadAccounts = document.querySelector('#load-accounts');
const invoiceSection = document.querySelector('#invoices-section');
const accounts = document.querySelector('#accounts');
const invoices = document.querySelector('#invoices');
const selectAllAccounts = document.querySelector('#select-all-accounts');
const selectAllInvoices = document.querySelector('#select-all-invoices');
const download = document.querySelector('#download');
const message = document.querySelector('#message');
let invoicesByAccount = new Map();

loadAccounts.addEventListener('click', () => void refreshAccounts());
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
      status.textContent = '● Sessão conectada'; status.className = 'status connected'; loadAccounts.disabled = false; return;
    }
    status.textContent = '● Faça login no portal da Equatorial'; status.className = 'status disconnected'; loadAccounts.disabled = true;
  } catch (error) {
    status.textContent = '● Abra o portal da Equatorial'; status.className = 'status disconnected'; showMessage(error.message, 'error');
  }
}

async function refreshAccounts() {
  setBusy(loadAccounts, true, 'CARREGANDO…'); clearMessage();
  try {
    const availableAccounts = await request('bode.accounts');
    accounts.replaceChildren(); invoices.replaceChildren(); invoicesByAccount = new Map();
    for (const item of availableAccounts) {
      const place = [item.address, item.city].filter(Boolean).join(' — ');
      const label = document.createElement('label'); label.className = 'choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.id;
      label.append(checkbox, document.createTextNode(place ? `${item.id} — ${place}` : item.id)); accounts.append(label);
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

  download.disabled = true; clearMessage(); let complete = 0;
  for (const { account, invoice } of items) {
    try {
      await request('bode.download', { account, invoiceNumber: invoice.invoiceNumber, competence: invoice.competence });
      complete += 1;
    } catch (error) {
      showMessage(`${complete}/${items.length} faturas baixadas. ${error.message}`, 'error'); updateButtons(); return;
    }
  }
  const unavailableMessage = unavailable ? ` ${unavailable} combinação(ões) sem fatura foram ignoradas.` : '';
  showMessage(`${complete}/${items.length} faturas baixadas.${unavailableMessage}`, 'success'); updateButtons();
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
