import { PDFDocument } from 'pdf-lib';

import type {
  InvoiceProviderInput,
  InvoiceSyncProvider,
  ProviderInvoiceFile,
} from './invoice-sync.provider';

export class OfflineInvoiceProvider implements InvoiceSyncProvider {
  readonly name = 'offline' as const;

  async downloadInvoice(
    input: InvoiceProviderInput,
  ): Promise<ProviderInvoiceFile> {
    const document = await PDFDocument.create();
    const page = document.addPage([595, 842]);
    page.drawText('Fatura de teste - processamento offline', {
      x: 50,
      y: 780,
      size: 16,
    });
    page.drawText(`Conta: ${input.account}`, { x: 50, y: 740, size: 12 });
    page.drawText(`Competência: ${input.competence}`, {
      x: 50,
      y: 720,
      size: 12,
    });
    return { content: Buffer.from(await document.save()) };
  }
}
