export function downloadFilename(holderName, consumerUnitNumber, account, competence) {
  const holderDirectory = safePathSegment(holderName, 'Titular não informado');
  const accountDirectory = consumerUnitNumber
    ? safePathSegment(`UC ${consumerUnitNumber} - Conta ${account}`, 'Conta não informada')
    : safePathSegment(`Conta ${account}`, 'Conta não informada');
  return `BODE/${holderDirectory}/${accountDirectory}/${safeFilename(competence).replace('/', '-')}.pdf`;
}

function safeFilename(value) {
  return String(value).replace(/[<>:"\\|?*]/g, '_');
}

function safePathSegment(value, fallback) {
  const segment = safeFilename(value || '').replaceAll('/', '_').trim();
  return segment || fallback;
}
