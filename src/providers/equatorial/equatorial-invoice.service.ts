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

  // A API usa null para uma fatura listada cuja segunda via ainda não foi
  // gerada. Campo ausente continua aceito para compatibilidade entre estados.
  if (!invoice || invoice.codigoBarras === null) {
    throw new EquatorialError(
      EquatorialErrorCode.INVOICE_NOT_AVAILABLE,
      `A fatura da competência ${competence} ainda não está disponível.`,
      true,
    );
  }

  return invoice;
}
