export interface InvoiceProviderInput {
  clientId: number;
  account: string;
  competence: string;
}

export interface ProviderInvoiceFile {
  content: Buffer;
}

export function invoiceInputKey(input: InvoiceProviderInput): string {
  return `${input.clientId}:${input.account}:${input.competence}`;
}

export interface InvoiceSyncProvider {
  readonly name: 'offline' | 'equatorial';
  downloadInvoices(inputs: InvoiceProviderInput[]): Promise<Map<string, ProviderInvoiceFile>>;
}
