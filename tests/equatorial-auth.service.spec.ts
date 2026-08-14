import { describe, expect, it } from 'vitest';

import {
  findAccessToken,
  findContractAccounts,
  isLikelyJwt,
  resolveLoginMode,
} from '../src/providers/equatorial/equatorial-auth.service';

const jwt =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0ZSIsImV4cCI6OTk5OTk5OTk5OX0.signature-for-test-only';

describe('captura de token', () => {
  it('encontra access_token aninhado na resposta de login', () => {
    expect(findAccessToken({ auth: { access_token: jwt } })).toBe(jwt);
  });

  it('não aceita valores comuns como JWT', () => {
    expect(isLikelyJwt('token-curto')).toBe(false);
    expect(findAccessToken({ token: 'captcha-response' })).toBeUndefined();
  });

  it('lista as contas contrato presentes no payload do JWT', () => {
    const payload = Buffer.from(
      JSON.stringify({
        userData: {
          ContasContrato: [
            { Numero: '000106375771' },
            { Numero: '003014581358' },
            { Numero: '000106375771' },
          ],
        },
      }),
    ).toString('base64url');
    const token = `header.${payload}.signature`;

    expect(findContractAccounts(token)).toEqual([
      '000106375771',
      '003014581358',
    ]);
  });

  it('prioriza o formulário de data e reconhece o formulário OTP', () => {
    expect(resolveLoginMode({ birthDateVisible: true, otpVisible: true })).toBe(
      'birth_date',
    );
    expect(
      resolveLoginMode({ birthDateVisible: false, otpVisible: true }),
    ).toBe('otp');
    expect(
      resolveLoginMode({ birthDateVisible: false, otpVisible: false }),
    ).toBeUndefined();
  });
});
