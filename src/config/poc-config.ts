import 'dotenv/config';

import { resolve } from 'node:path';

import { z } from 'zod';

const schema = z.object({
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
  EQUATORIAL_ACCOUNT: z.string().trim().min(1),
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
  EQUATORIAL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  POC_OUTPUT_DIR: z.string().trim().min(1).default('output/equatorial'),
});

export interface PocConfig {
  portalUrl: string;
  apiUrl: string;
  document: string;
  birthDate: string;
  account: string;
  competence: string;
  headless: boolean;
  browserTimeoutMs: number;
  browserChannel: 'chrome' | 'chromium';
  persistentBrowserContext: boolean;
  browserUserDataDirectory: string;
  apiTimeoutMs: number;
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
    const missingFields = result.error.issues
      .map((issue) => issue.path.join('.'))
      .filter(Boolean)
      .join(', ');

    throw new PocConfigurationError(missingFields.split(', ').filter(Boolean));
  }

  const value = result.data;

  return {
    portalUrl: value.EQUATORIAL_PORTAL_URL,
    apiUrl: value.EQUATORIAL_API_URL,
    document: value.EQUATORIAL_DOCUMENT,
    birthDate: value.EQUATORIAL_BIRTH_DATE,
    account: value.EQUATORIAL_ACCOUNT,
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
    outputDirectory: resolve(process.cwd(), value.POC_OUTPUT_DIR),
  };
}
