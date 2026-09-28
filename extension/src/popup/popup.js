/* global chrome, document, Option */
const status = document.querySelector('#session-status');
const account = document.querySelector('#account');
const loadAccounts = document.querySelector('#load-accounts');
const invoiceSection = document.querySelector('#invoices-section');
const invoices = document.querySelector('#invoices');
const selectAll = document.querySelector('#select-all');
const download = document.querySelector('#download');
const message = document.querySelector('#message');

loadAccounts.addEventListener('click', () => void refreshAccounts());
account.addEventListener('change', () => void refreshInvoices());
selectAll.addEventListener('click', () => {
  const checkboxes = invoices.querySelectorAll('input[type="checkbox"]');
  const shouldSelectAll = [...checkboxes].some((checkbox) => !checkbox.checked);
  for (const checkbox of checkboxes) checkbox.checked = shouldSelectAll;
  updateDownloadButton();
});
invoices.addEventListener('change', updateDownloadButton);
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
    const availableAccounts = await request('bode.accounts'); account.replaceChildren(new Option('Selecione uma unidade', ''));
    for (const item of availableAccounts) {
      const place = [item.address, item.city].filter(Boolean).join(' — ');
      account.add(new Option(place ? `${item.id} — ${place}` : item.id, item.id));
    }
    account.disabled = false; invoiceSection.hidden = true;
  } catch (error) { showMessage(error.message, 'error'); }
  finally { setBusy(loadAccounts, false, 'ATUALIZAR UNIDADES'); }
}
async function refreshInvoices() {
  const accountId = account.value; if (!accountId) return;
  clearMessage(); invoices.replaceChildren(); invoiceSection.hidden = false; download.disabled = true;
  try {
    const availableInvoices = await request('bode.invoices', { account: accountId });
    if (!availableInvoices.length) { showMessage('Nenhuma fatura disponível para esta unidade.', 'error'); return; }
    for (const invoice of availableInvoices) {
      const label = document.createElement('label'); label.className = 'invoice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = JSON.stringify(invoice);
      label.append(checkbox, document.createTextNode(invoice.competence)); invoices.append(label);
    }
  } catch (error) { showMessage(error.message, 'error'); }
}
async function downloadSelected() {
  const selected = [...invoices.querySelectorAll('input:checked')].map((input) => JSON.parse(input.value)); if (!selected.length) return;
  download.disabled = true; clearMessage(); let complete = 0;
  for (const invoice of selected) {
    try { await request('bode.download', { account: account.value, invoiceNumber: invoice.invoiceNumber, competence: invoice.competence }); complete += 1; }
    catch (error) { showMessage(`${complete}/${selected.length} baixadas. ${error.message}`, 'error'); updateDownloadButton(); return; }
  }
  showMessage(`${complete}/${selected.length} faturas baixadas.`, 'success'); updateDownloadButton();
}
function updateDownloadButton() {
  const checkboxes = invoices.querySelectorAll('input[type="checkbox"]');
  download.disabled = !invoices.querySelector('input:checked');
  selectAll.textContent = checkboxes.length && [...checkboxes].every((checkbox) => checkbox.checked) ? 'Nenhuma' : 'Todas';
}
async function request(type, payload = {}) { const response = await chrome.runtime.sendMessage({ type, ...payload }); if (!response?.ok) throw new Error(response?.error || 'Falha inesperada.'); return response.value; }
function setBusy(button, busy, label) { button.disabled = busy; button.textContent = label; }
function showMessage(text, type) { message.textContent = text; message.className = `message ${type}`; }
function clearMessage() { message.textContent = ''; message.className = 'message'; }
