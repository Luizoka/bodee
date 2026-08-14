import { describe, expect, it } from 'vitest';

import { loadPocConfig, PocConfigurationError } from '../src/config/poc-config';

describe('loadPocConfig', () => {
  it('aceita somente a lista de contas contrato', () => {
    const config = loadPocConfig({
      EQUATORIAL_DOCUMENT: 'document',
      EQUATORIAL_BIRTH_DATE: '01/01/1990',
      EQUATORIAL_ACCOUNTS: '111, 222,111',
      EQUATORIAL_COMPETENCE: '2026/08',
    });

    expect(config.accounts).toEqual(['111', '222']);
    expect(config.account).toBe('111');
  });

  it('informa apenas os nomes das variáveis obrigatórias ausentes', () => {
    try {
      loadPocConfig({
        EQUATORIAL_DOCUMENT: '',
        EQUATORIAL_BIRTH_DATE: '',
        EQUATORIAL_ACCOUNT: '',
        EQUATORIAL_COMPETENCE: '2026/08',
      });
      expect.fail('a configuração incompleta deveria falhar');
    } catch (error) {
      expect(error).toBeInstanceOf(PocConfigurationError);
      expect(error).toMatchObject({
        invalidVariables: [
          'EQUATORIAL_DOCUMENT',
          'EQUATORIAL_BIRTH_DATE',
          'EQUATORIAL_ACCOUNT',
        ],
      });
    }
  });
});
