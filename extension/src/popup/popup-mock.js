const accounts = [
  { id: '452643701343', consumerUnitNumber: '4.526.437.013-43', holderName: 'ANTONIA MARIA DA SILVA SANTAREM', address: 'Rua das Palmeiras, 182', city: 'Moju dos Campos' },
  { id: '378781013990', consumerUnitNumber: '3.787.810.13-99', holderName: 'ANTONIA MARIA DA SILVA SANTAREM', address: 'Travessa São Jorge, 45', city: 'Santarém' },
  { id: '449214010138', consumerUnitNumber: '4.492.110.013-08', holderName: 'ANTONIA MARIA DA SILVA SANTAREM', address: 'Comunidade Boa Esperança, Ramal do Sol', city: 'Belterra' },
  { id: '230812901383', consumerUnitNumber: '2.308.129.013-83', holderName: 'ANTONIA MARIA DA SILVA SANTAREM', address: 'Av. Tapajós, 1024, Bloco B', city: 'Santarém' },
  { id: '778004512629', consumerUnitNumber: '7.780.045.126-29', holderName: 'ANTONIA MARIA DA SILVA SANTAREM', address: 'Estrada do Piquiá, km 12', city: 'Moju dos Campos' },
];

const competences = ['2026/10', '2026/09', '2026/08', '2026/07', '2026/06', '2026/05', '2026/04', '2026/03', '2026/02', '2026/01', '2025/12', '2025/11'];
const invoicesByAccount = new Map(accounts.map((account, accountIndex) => [
  account.id,
  competences
    .filter((_, competenceIndex) => (accountIndex + competenceIndex) % 5 !== 0)
    .map((competence, competenceIndex) => ({
      competence,
      invoiceNumber: `FAT-${account.id.slice(-4)}-${String(competenceIndex + 1).padStart(3, '0')}`,
      open: competenceIndex < 4,
    })),
]));

const initialQueue = [
  ['452643701343', '2026/10', 'COMPLETED'],
  ['378781013990', '2026/10', 'DOWNLOADING'],
  ['449214010138', '2026/09', 'PENDING'],
  ['230812901383', '2026/09', 'FAILED', 'Portal indisponível'],
  ['778004512629', '2026/08', 'COMPLETED'],
  ['452643701343', '2026/08', 'PENDING'],
  ['378781013990', '2026/07', 'COMPLETED'],
  ['449214010138', '2026/07', 'FAILED', 'Fatura não localizada'],
  ['230812901383', '2026/06', 'PENDING'],
  ['778004512629', '2026/06', 'COMPLETED'],
].map(([account, competence, status, error]) => ({
  account,
  consumerUnitNumber: accounts.find((item) => item.id === account).consumerUnitNumber,
  competence,
  status,
  ...(error ? { error } : {}),
}));

function createMockJob(items = initialQueue) {
  const complete = items.filter((item) => item.status === 'COMPLETED').length;
  const failed = items.filter((item) => item.status === 'FAILED').length;
  return { status: 'COMPLETED', total: items.length, complete, failed, items };
}

export async function mockRequest(type, payload = {}) {
  switch (type) {
    case 'bode.status': return { authenticated: true, profileKey: 'local-mock-profile' };
    case 'bode.accounts': return accounts;
    case 'bode.invoices': {
      const available = invoicesByAccount.get(payload.account) || [];
      return payload.openOnly ? available.filter((invoice) => invoice.open) : available;
    }
    case 'bode.download-status': return createMockJob();
    case 'bode.download-queue': {
      const items = payload.downloads.map((item, index) => ({
        ...item,
        status: ['COMPLETED', 'DOWNLOADING', 'PENDING', 'FAILED'][index % 4],
        ...(index % 4 === 3 ? { error: 'Falha simulada para teste' } : {}),
      }));
      return createMockJob(items.length ? items : initialQueue);
    }
    case 'bode.open-portal': return undefined;
    default: throw new Error(`Ação mock não suportada: ${type}`);
  }
}
