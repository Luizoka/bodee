import { describe, expect, it } from 'vitest';

import {
  findAccessToken,
  findContractAccounts,
  getPostFieldNames,
  isLikelyJwt,
  isLoginDeniedPayload,
  parseEquatorialAccounts,
  requireEquatorialAccounts,
  resolveLoginMode,
  runControlledAuthAttempts,
  validateAuthenticationPostData,
  validateAuthenticationResult,
} from '../src/providers/equatorial/equatorial-auth.service';
import { EquatorialError } from '../src/providers/equatorial/equatorial.errors';

const jwt =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0ZSIsImV4cCI6OTk5OTk5OTk5OX0.signature-for-test-only';

function captureEquatorialError(action: () => void): EquatorialError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(EquatorialError);
    return error as EquatorialError;
  }
  throw new Error('A ação deveria lançar EquatorialError.');
}

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

describe('fluxo real de autenticação', () => {
  it('registra apenas os nomes dos campos enviados', () => {
    const postData = new URLSearchParams({
      username: 'valor-que-nao-pode-aparecer',
      password: 'outro-valor-sensivel',
      tokengr: 'captcha-secreto',
    }).toString();

    const serialized = JSON.stringify(getPostFieldNames(postData));
    expect(serialized).toContain('username');
    expect(serialized).toContain('password');
    expect(serialized).toContain('tokengr');
    expect(serialized).not.toContain('valor-que-nao-pode-aparecer');
    expect(serialized).not.toContain('outro-valor-sensivel');
    expect(serialized).not.toContain('captcha-secreto');

    const multipart = [
      '------boundary',
      'Content-Disposition: form-data; name="cpf-novo-otp"',
      '',
      '00000000000',
      '------boundary--',
    ].join('\r\n');
    expect(getPostFieldNames(multipart)).toEqual(['cpf-novo-otp']);
    expect(JSON.stringify(getPostFieldNames(multipart))).not.toContain(
      '00000000000',
    );
  });

  it('valida a estrutura produzida pelos scripts da página', () => {
    const data = new URLSearchParams({
      grant_type: 'password',
      username: '1:00000000000',
      password: '1990-01-01',
      actiongr: 'login',
      tokengr: 'generated-by-page',
      navegador: 'Chrome',
      dispositivo: 'desktop',
      empresaId: '1',
      transmit_token: 'generated-by-page',
      transmit_user: ' ',
    });

    expect(() => validateAuthenticationPostData(data.toString())).not.toThrow();
    data.delete('tokengr');
    expect(
      captureEquatorialError(() =>
        validateAuthenticationPostData(data.toString()),
      ),
    ).toMatchObject({ code: 'SCRIPT_LOAD_FAILED' });
  });

  it('diferencia DENY, bloqueio externo e sucesso HTTP', () => {
    expect(isLoginDeniedPayload({ error: 'DENY' })).toBe(true);
    expect(() => validateAuthenticationResult(200, { ok: true })).not.toThrow();
    expect(
      captureEquatorialError(() =>
        validateAuthenticationResult(500, {
          error: 'DENY',
          error_description: 'DENY',
        }),
      ),
    ).toMatchObject({
      code: 'EQUATORIAL_LOGIN_DENIED',
      retryable: true,
    });
    expect(
      captureEquatorialError(() =>
        validateAuthenticationResult(403, undefined),
      ),
    ).toMatchObject({ code: 'PAGE_BLOCKED', retryable: false });
  });

  it('modela e remove duplicatas das unidades consumidoras', () => {
    expect(
      parseEquatorialAccounts([
        {
          numero: '000123',
          numeroInstalacao: '456',
          ucMascarada: '***123',
          endereco: 'Rua de teste',
          bairro: 'Centro',
          cidade: 'Belém',
        },
        { numero: '000123' },
        { semIdentificador: true },
      ]),
    ).toEqual([
      {
        id: '000123',
        installationNumber: '456',
        maskedConsumerUnit: '***123',
        address: 'Rua de teste',
        neighborhood: 'Centro',
        city: 'Belém',
      },
    ]);
    expect(parseEquatorialAccounts([])).toEqual([]);
    expect(
      captureEquatorialError(() => requireEquatorialAccounts([])),
    ).toMatchObject({ code: 'ACCOUNT_LIST_FAILED', retryable: true });
  });

  it('faz no máximo três tentativas e espera 2s e 5s', async () => {
    const attempts: number[] = [];
    const delays: number[] = [];
    const result = await runControlledAuthAttempts(
      10,
      [2_000, 5_000],
      (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) {
          return Promise.reject(
            new EquatorialError('EQUATORIAL_LOGIN_DENIED', 'deny', true),
          );
        }
        return Promise.resolve('authenticated');
      },
      undefined,
      (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
    );

    expect(result).toBe('authenticated');
    expect(attempts).toEqual([1, 2, 3]);
    expect(delays).toEqual([2_000, 5_000]);
  });

  it('não repete um bloqueio externo não recuperável', async () => {
    let attempts = 0;
    await expect(
      runControlledAuthAttempts(
        3,
        [2_000, 5_000],
        () => {
          attempts += 1;
          return Promise.reject(
            new EquatorialError('PAGE_BLOCKED', 'blocked', false),
          );
        },
        undefined,
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ code: 'PAGE_BLOCKED' });
    expect(attempts).toBe(1);
  });
});
