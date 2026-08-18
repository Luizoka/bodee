export interface InvoiceStorageReference {
  provider: 'local' | 'supabase';
  filename: string;
  filePath?: string | undefined;
  bucket?: string | undefined;
  storagePath?: string | undefined;
}

export interface InvoiceStorage {
  save(
    clientId: number,
    account: string,
    competence: string,
    content: Buffer,
  ): Promise<InvoiceStorageReference>;
  get(
    reference: InvoiceStorageReference,
  ): Promise<{ content: Buffer; filename: string }>;
  delete(reference: InvoiceStorageReference): Promise<void>;
}
