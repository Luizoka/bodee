import { describe, expect, it } from 'vitest';

import { EquatorialErrorCode } from '../src/providers/equatorial/equatorial.errors';
import {
  listAvailableCompetences,
  selectInvoiceByCompetence,
} from '../src/providers/equatorial/equatorial-invoice.service';

describe('selectInvoiceByCompetence', () => {
  const invoices = [
    { numeroFatura: 'first', competencia: '2026/07' },
    { numeroFatura: 'target', competencia: '2026/08' },
  ];

  it('seleciona pela competência em vez da posição', () => {
    expect(selectInvoiceByCompetence(invoices, '2026/08')).toMatchObject({
      numeroFatura: 'target',
    });
  });

  it('classifica uma competência ausente como situação aguardável', () => {
    try {
      selectInvoiceByCompetence(invoices, '2026/09');
      expect.fail('deveria informar que a fatura ainda não está disponível');
    } catch (error) {
      expect(error).toMatchObject({
        code: EquatorialErrorCode.INVOICE_NOT_AVAILABLE,
        retryable: true,
      });
    }
  });

  it('lista competências sem expor outros dados da fatura', () => {
    expect(listAvailableCompetences(invoices)).toEqual(['2026/07', '2026/08']);
  });
});
