import { describe, expect, it } from 'vitest';

import {
  buildCompetenceRange,
  loadPocConfig,
  PocConfigurationError,
} from '../src/config/poc-config';

describe('loadPocConfig', () => {
  it('aceita somente a lista de contas contrato', () => {
    const config = loadPocConfig({
      EQUATORIAL_DOCUMENT: 'document',
      EQUATORIAL_BIRTH_DATE: '01/01/1990',
      EQUATORIAL_ACCOUNT: '',
      EQUATORIAL_ACCOUNTS: '111, 222,111',
      EQUATORIAL_COMPETENCE: '2026/08',
    });

    expect(config.accounts).toEqual(['111', '222']);
    expect(config.account).toBe('111');
    expect(config.competences).toEqual(['2026/08']);
  });

  it('gera um intervalo inclusivo na ordem informada', () => {
    const config = loadPocConfig({
      EQUATORIAL_DOCUMENT: 'document',
      EQUATORIAL_BIRTH_DATE: '01/01/1990',
      EQUATORIAL_ACCOUNT: '111',
      EQUATORIAL_COMPETENCE: '',
      EQUATORIAL_COMPETENCE_START: '2026/02',
      EQUATORIAL_COMPETENCE_END: '2025/11',
    });

    expect(config.competences).toEqual([
      '2026/02',
      '2026/01',
      '2025/12',
      '2025/11',
    ]);
    expect(config.competence).toBe('2026/02');
    expect(buildCompetenceRange('2025/11', '2026/02')).toEqual([
      '2025/11',
      '2025/12',
      '2026/01',
      '2026/02',
    ]);
  });

  it('aceita uma lista de competências e remove duplicatas', () => {
    const config = loadPocConfig({
      EQUATORIAL_DOCUMENT: 'document',
      EQUATORIAL_BIRTH_DATE: '01/01/1990',
      EQUATORIAL_ACCOUNT: '111',
      EQUATORIAL_COMPETENCES: '2026/08, 2026/07,2026/08',
    });

    expect(config.competences).toEqual(['2026/08', '2026/07']);
  });

  it('rejeita formas simultâneas de configurar competências', () => {
    expect(() =>
      loadPocConfig({
        EQUATORIAL_DOCUMENT: 'document',
        EQUATORIAL_BIRTH_DATE: '01/01/1990',
        EQUATORIAL_ACCOUNT: '111',
        EQUATORIAL_COMPETENCE: '2026/08',
        EQUATORIAL_COMPETENCES: '2026/07',
      }),
    ).toThrow(PocConfigurationError);
  });

  it('rejeita intervalo incompleto e contas com caracteres inválidos', () => {
    try {
      loadPocConfig({
        EQUATORIAL_DOCUMENT: 'document',
        EQUATORIAL_BIRTH_DATE: '01/01/1990',
        EQUATORIAL_ACCOUNTS: '111, conta-222',
        EQUATORIAL_COMPETENCE_START: '2026/08',
      });
      expect.fail('a configuração inválida deveria falhar');
    } catch (error) {
      expect(error).toMatchObject({
        invalidVariables: ['EQUATORIAL_ACCOUNTS', 'EQUATORIAL_COMPETENCE_END'],
      });
    }
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
          'EQUATORIAL_ACCOUNT ou EQUATORIAL_ACCOUNTS',
        ],
      });
    }
  });
});
