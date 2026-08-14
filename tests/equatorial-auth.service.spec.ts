import { describe, expect, it } from 'vitest';

import {
  findAccessToken,
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
