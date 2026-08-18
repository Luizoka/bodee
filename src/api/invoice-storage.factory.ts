import { ExternalInvoiceStorageService } from './external-invoice-storage.service';
import type {
  InvoiceStorage,
  InvoiceStorageReference,
} from './invoice-storage';
import { LocalInvoiceStorageService } from './local-invoice-storage.service';

export const INVOICE_STORAGE = Symbol('INVOICE_STORAGE');

class ConfiguredInvoiceStorage implements InvoiceStorage {
  private readonly local = new LocalInvoiceStorageService();
  private external: ExternalInvoiceStorageService | undefined;

  constructor(private readonly writeProvider: 'local' | 'supabase') {}

  private getExternal(): ExternalInvoiceStorageService {
    this.external ??= new ExternalInvoiceStorageService();
    return this.external;
  }

  async save(
    clientId: number,
    account: string,
    competence: string,
    content: Buffer,
  ): Promise<InvoiceStorageReference> {
    return this.writeProvider === 'local'
      ? this.local.save(clientId, account, competence, content)
      : this.getExternal().save(clientId, account, competence, content);
  }

  async get(reference: InvoiceStorageReference) {
    return reference.provider === 'local'
      ? this.local.get(reference)
      : this.getExternal().get(reference);
  }

  async delete(reference: InvoiceStorageReference): Promise<void> {
    return reference.provider === 'local'
      ? this.local.delete(reference)
      : this.getExternal().delete(reference);
  }
}

export function createInvoiceStorage(): InvoiceStorage {
  const provider = process.env.INVOICE_STORAGE_PROVIDER ?? 'local';
  if (provider !== 'local' && provider !== 'supabase') {
    throw new Error('INVOICE_STORAGE_PROVIDER deve ser local ou supabase.');
  }
  return new ConfiguredInvoiceStorage(provider);
}
