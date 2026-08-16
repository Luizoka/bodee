export interface InvoiceProviderInput {
  clientId: number;
  account: string;
  competence: string;
}

export interface ProviderInvoiceFile {
  content: Buffer;
}

export interface InvoiceSyncProvider {
  readonly name: 'offline' | 'equatorial';
  downloadInvoice(input: InvoiceProviderInput): Promise<ProviderInvoiceFile>;
}
