/* global chrome */
// O content script não lê credenciais nem tokens. Ele somente informa ao
// service worker que uma página elegível da Equatorial está aberta.
chrome.runtime.sendMessage({ type: 'bode.portal-ready' }).catch(() => undefined);
