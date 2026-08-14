import { describe, expect, it } from 'vitest';

import { loadPocConfig, PocConfigurationError } from '../src/config/poc-config';

describe('loadPocConfig', () => {
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
