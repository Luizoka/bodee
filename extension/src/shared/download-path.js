export function downloadFilename(holderName, consumerUnitNumber, account, competence) {
  const holderDirectory = safePathSegment(holderName, 'Titular não informado');
  const accountDirectory = consumerUnitNumber
    ? safePathSegment(`UC ${consumerUnitNumber} - CC ${account}`, 'CC não informada')
    : safePathSegment(`CC ${account}`, 'CC não informada');
  const competenceFilename = safeFilename(competence).replace('/', '-');
  const invoiceFilename = consumerUnitNumber
    ? `${competenceFilename} - ${safeFilename(consumerUnitNumber)}`
    : competenceFilename;
  return `BODEE/${holderDirectory}/${accountDirectory}/${invoiceFilename}.pdf`;
}

function safeFilename(value) {
  return String(value).replace(/[<>:"\\|?*]/g, '_');
}

function safePathSegment(value, fallback) {
  const segment = safeFilename(value || '').replaceAll('/', '_').trim();
  return segment || fallback;
}
