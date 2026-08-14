import { describe, expect, it } from 'vitest';

import { sanitizeForLog } from '../src/shared/logging/poc-logger';

describe('sanitizeForLog', () => {
  it('remove segredos inclusive em objetos aninhados', () => {
    expect(
      sanitizeForLog({
        token: 'secret',
        nested: { cpf: '00000000000', status: 'ok' },
      }),
    ).toEqual({
      token: '[REDACTED]',
      nested: { cpf: '[REDACTED]', status: 'ok' },
    });
  });
});
