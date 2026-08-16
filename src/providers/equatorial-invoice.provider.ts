import type { EquatorialCredentials } from '../api/api.service';

import type {
  InvoiceProviderInput,
  InvoiceSyncProvider,
  ProviderInvoiceFile,
} from './invoice-sync.provider';

export class EquatorialInvoiceProvider implements InvoiceSyncProvider {
  readonly name = 'equatorial' as const;

  constructor(
    private readonly loadCredentials: (
      clientId: number,
    ) => Promise<EquatorialCredentials | undefined>,
  ) {}

  async downloadInvoice(
    input: InvoiceProviderInput,
  ): Promise<ProviderInvoiceFile> {
    const credentials = await this.loadCredentials(input.clientId);
    if (!credentials) {
      throw new Error('Credenciais da Equatorial não estão configuradas para o cliente.');
    }

    // A integração real reutilizará essas credenciais apenas durante a execução
    // do provider. Ela permanece desativada até o portal estar disponível.
    throw new Error(
      'O provider Equatorial ainda não está habilitado. Use SYNC_PROVIDER=offline.',
    );
  }
}
