import { describe, expect, it, vi } from 'vitest';
import { queryInvoicesByAccount } from '../extension/src/popup/invoice-query.js';

type Invoice = { invoiceNumber: string; competence: string };
type QueryResult = {
  results: Array<[string, Invoice[]]>;
  failures: Array<{ account: string; error: unknown }>;
};
const queryAccountInvoices = queryInvoicesByAccount as (
  accounts: string[],
  query: (account: string) => Promise<Invoice[]>,
) => Promise<QueryResult>;

describe('consulta de faturas por unidade', () => {
  it('preserva as respostas válidas quando uma unidade falha', async () => {
    const invoice = { invoiceNumber: 'FAT-1', competence: '2026/09' };
    const query = vi.fn((account: string) => account === 'sem-faturas'
      ? Promise.reject(new Error('Não foi possível consultar as faturas.'))
      : Promise.resolve([invoice]));

    const result = await queryAccountInvoices(['conta-ok', 'sem-faturas'], query);

    expect(result.results).toEqual([['conta-ok', [invoice]]]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.account).toBe('sem-faturas');
    expect(result.failures[0]?.error).toBeInstanceOf(Error);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('mantém contas sem faturas como consultas válidas', async () => {
    await expect(queryAccountInvoices(['sem-faturas'], () => Promise.resolve([]))).resolves.toEqual({
      results: [['sem-faturas', []]],
      failures: [],
    });
  });
});
