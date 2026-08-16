import { PDFDocument } from 'pdf-lib';

import {
  invoiceInputKey,
  type
  InvoiceProviderInput,
  InvoiceSyncProvider,
  ProviderInvoiceFile,
} from './invoice-sync.provider';

export class OfflineInvoiceProvider implements InvoiceSyncProvider {
  readonly name = 'offline' as const;

  private async createInvoice(
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

  async downloadInvoices(inputs: InvoiceProviderInput[]): Promise<Map<string, ProviderInvoiceFile>> {
    const files = new Map<string, ProviderInvoiceFile>();
    for (const input of inputs) files.set(invoiceInputKey(input), await this.createInvoice(input));
    return files;
  }
}
