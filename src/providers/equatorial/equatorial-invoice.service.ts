import { EquatorialError, EquatorialErrorCode } from './equatorial.errors';
import type { EquatorialInvoice } from './equatorial.types';

export function listAvailableCompetences(
  invoices: readonly EquatorialInvoice[],
): string[] {
  return [...new Set(invoices.map((invoice) => invoice.competencia))].sort();
}

export function selectInvoiceByCompetence(
  invoices: readonly EquatorialInvoice[],
  competence: string,
): EquatorialInvoice {
  const invoice = invoices.find((item) => item.competencia === competence);

  if (!invoice) {
    throw new EquatorialError(
      EquatorialErrorCode.INVOICE_NOT_AVAILABLE,
      `A fatura da competência ${competence} ainda não está disponível.`,
      true,
    );
  }

  return invoice;
}
