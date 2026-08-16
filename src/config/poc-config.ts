import 'dotenv/config';

import { resolve } from 'node:path';

import { z } from 'zod';

const schema = z
  .object({
    EQUATORIAL_PORTAL_URL: z
      .url()
      .default('https://pa.equatorialenergia.com.br/siteantigo'),
    EQUATORIAL_API_URL: z
      .url()
      .default('https://api-pa-cliente.equatorialenergia.com.br'),
    EQUATORIAL_DOCUMENT: z.string().trim().min(1),
    EQUATORIAL_BIRTH_DATE: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'use DD/MM/AAAA'),
    EQUATORIAL_ACCOUNT: z.string().trim().min(1).optional(),
    EQUATORIAL_ACCOUNTS: z.string().trim().optional(),
    EQUATORIAL_COMPETENCE: z
      .string()
      .regex(/^\d{4}\/(0[1-9]|1[0-2])$/, 'use AAAA/MM'),
    PLAYWRIGHT_HEADLESS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    PLAYWRIGHT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    PLAYWRIGHT_BROWSER_CHANNEL: z
      .enum(['chrome', 'chromium'])
      .default('chromium'),
    PLAYWRIGHT_PERSISTENT_CONTEXT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PLAYWRIGHT_USER_DATA_DIR: z
      .string()
      .trim()
      .min(1)
      .default('output/browser-profile'),
    EQUATORIAL_API_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30_000),
    DATABASE_URL: z.string().url().optional(),
    API_PORT: z.coerce.number().int().positive().default(3000),
    CREDENTIALS_ENCRYPTION_KEY: z.string().length(64).optional(),
    POC_OUTPUT_DIR: z.string().trim().min(1).default('output/equatorial'),
  })
  .superRefine((value, context) => {
    const hasSingleAccount = Boolean(value.EQUATORIAL_ACCOUNT);
    const hasMultipleAccounts = Boolean(
      value.EQUATORIAL_ACCOUNTS?.split(',').some((item) => item.trim()),
    );

    if (!hasSingleAccount && !hasMultipleAccounts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EQUATORIAL_ACCOUNT ou EQUATORIAL_ACCOUNTS'],
        message: 'informe EQUATORIAL_ACCOUNT ou EQUATORIAL_ACCOUNTS',
      });
    }
  });

export interface PocConfig {
  portalUrl: string;
  apiUrl: string;
  document: string;
  birthDate: string;
  account: string;
  accounts: string[];
  competence: string;
  headless: boolean;
  browserTimeoutMs: number;
  browserChannel: 'chrome' | 'chromium';
  persistentBrowserContext: boolean;
  browserUserDataDirectory: string;
  apiTimeoutMs: number;
  databaseUrl: string | undefined;
  apiPort: number;
  credentialsEncryptionKey: string | undefined;
  outputDirectory: string;
}

export class PocConfigurationError extends Error {
  constructor(public readonly invalidVariables: string[]) {
    super('Configuração inválida para executar a POC.');
    this.name = 'PocConfigurationError';
  }
}

export function loadPocConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PocConfig {
  const result = schema.safeParse(environment);

  if (!result.success) {
    const invalidVariables = [
      ...new Set(
        result.error.issues
          .map((issue) => issue.path.join('.'))
          .filter(Boolean),
      ),
    ];
    const accountChoice = 'EQUATORIAL_ACCOUNT ou EQUATORIAL_ACCOUNTS';
    if (invalidVariables.includes(accountChoice)) {
      const index = invalidVariables.indexOf('EQUATORIAL_ACCOUNT');
      if (index >= 0) invalidVariables.splice(index, 1);
    }

    throw new PocConfigurationError(invalidVariables);
  }

  const value = result.data;
  const accounts = value.EQUATORIAL_ACCOUNTS
    ? [
        ...new Set(
          value.EQUATORIAL_ACCOUNTS.split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : value.EQUATORIAL_ACCOUNT
      ? [value.EQUATORIAL_ACCOUNT]
      : [];

  if (accounts.length === 0) {
    throw new PocConfigurationError([
      'EQUATORIAL_ACCOUNT ou EQUATORIAL_ACCOUNTS',
    ]);
  }

  return {
    portalUrl: value.EQUATORIAL_PORTAL_URL,
    apiUrl: value.EQUATORIAL_API_URL,
    document: value.EQUATORIAL_DOCUMENT,
    birthDate: value.EQUATORIAL_BIRTH_DATE,
    account: accounts[0] ?? '',
    accounts,
    competence: value.EQUATORIAL_COMPETENCE,
    headless: value.PLAYWRIGHT_HEADLESS,
    browserTimeoutMs: value.PLAYWRIGHT_TIMEOUT_MS,
    browserChannel: value.PLAYWRIGHT_BROWSER_CHANNEL,
    persistentBrowserContext: value.PLAYWRIGHT_PERSISTENT_CONTEXT,
    browserUserDataDirectory: resolve(
      process.cwd(),
      value.PLAYWRIGHT_USER_DATA_DIR,
    ),
    apiTimeoutMs: value.EQUATORIAL_API_TIMEOUT_MS,
    databaseUrl: value.DATABASE_URL,
    apiPort: value.API_PORT,
    credentialsEncryptionKey: value.CREDENTIALS_ENCRYPTION_KEY,
    outputDirectory: resolve(process.cwd(), value.POC_OUTPUT_DIR),
  };
}
