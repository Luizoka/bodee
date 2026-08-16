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

  async downloadInvoices(
    inputs: InvoiceProviderInput[],
  ): Promise<Map<string, ProviderInvoiceFile>> {
    for (const clientId of new Set(inputs.map((input) => input.clientId))) {
      if (!(await this.loadCredentials(clientId))) {
        throw new Error('Credenciais da Equatorial não estão configuradas para o cliente.');
      }
    }

    // A versão real abrirá uma sessão por cliente para todo o lote e descartará
    // token, cookies e contexto do navegador ao terminar.
    throw new Error(
      'O provider Equatorial ainda não está habilitado. Use SYNC_PROVIDER=offline.',
    );
  }
}
