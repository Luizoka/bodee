import 'dotenv/config';

import { resolve } from 'node:path';

import { z } from 'zod';

const competencePattern = /^\d{4}\/(0[1-9]|1[0-2])$/;
const maxCompetencesPerRun = 120;
const competenceSource =
  'EQUATORIAL_COMPETENCE, EQUATORIAL_COMPETENCES ou EQUATORIAL_COMPETENCE_START/EQUATORIAL_COMPETENCE_END';

const optionalCompetence = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().regex(competencePattern, 'use AAAA/MM').optional(),
);

const optionalAccount = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);

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
    EQUATORIAL_ACCOUNT: optionalAccount,
    EQUATORIAL_ACCOUNTS: z.string().trim().optional(),
    EQUATORIAL_COMPETENCE: optionalCompetence,
    EQUATORIAL_COMPETENCES: z.string().trim().optional(),
    EQUATORIAL_COMPETENCE_START: optionalCompetence,
    EQUATORIAL_COMPETENCE_END: optionalCompetence,
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

    if (value.EQUATORIAL_ACCOUNT && !/^\d+$/.test(value.EQUATORIAL_ACCOUNT)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EQUATORIAL_ACCOUNT'],
        message: 'use somente os dígitos da conta contrato',
      });
    }

    if (
      value.EQUATORIAL_ACCOUNTS?.split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .some((account) => !/^\d+$/.test(account))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EQUATORIAL_ACCOUNTS'],
        message: 'use contas com somente dígitos, separadas por vírgula',
      });
    }

    const listedCompetences = value.EQUATORIAL_COMPETENCES?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const hasSingleCompetence = Boolean(value.EQUATORIAL_COMPETENCE);
    const hasListedCompetences = Boolean(listedCompetences?.length);
    const hasRangeStart = Boolean(value.EQUATORIAL_COMPETENCE_START);
    const hasRangeEnd = Boolean(value.EQUATORIAL_COMPETENCE_END);
    const hasAnyRange = hasRangeStart || hasRangeEnd;

    if (
      listedCompetences?.some(
        (competence) => !competencePattern.test(competence),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EQUATORIAL_COMPETENCES'],
        message: 'use competências separadas por vírgula no formato AAAA/MM',
      });
    }

    if (hasRangeStart !== hasRangeEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          hasRangeStart
            ? 'EQUATORIAL_COMPETENCE_END'
            : 'EQUATORIAL_COMPETENCE_START',
        ],
        message: 'informe o início e o fim do intervalo',
      });
    }

    const configuredModes = [
      hasSingleCompetence,
      hasListedCompetences,
      hasAnyRange,
    ].filter(Boolean).length;

    if (configuredModes === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [competenceSource],
        message: 'informe uma competência, uma lista ou um intervalo',
      });
    } else if (configuredModes > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [competenceSource],
        message: 'use somente uma forma de configurar as competências',
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
  competences: string[];
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

function monthIndex(competence: string): number {
  const [year, month] = competence.split('/').map(Number);
  return (year ?? 0) * 12 + (month ?? 1) - 1;
}

function competenceFromMonthIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}`;
}

export function buildCompetenceRange(start: string, end: string): string[] {
  const startIndex = monthIndex(start);
  const endIndex = monthIndex(end);
  const direction = startIndex <= endIndex ? 1 : -1;
  const count = Math.abs(endIndex - startIndex) + 1;

  if (count > maxCompetencesPerRun) {
    throw new PocConfigurationError([
      'EQUATORIAL_COMPETENCE_START/EQUATORIAL_COMPETENCE_END',
    ]);
  }

  return Array.from({ length: count }, (_, offset) =>
    competenceFromMonthIndex(startIndex + offset * direction),
  );
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

  const listedCompetences = value.EQUATORIAL_COMPETENCES
    ? [
        ...new Set(
          value.EQUATORIAL_COMPETENCES.split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  const competences =
    value.EQUATORIAL_COMPETENCE_START && value.EQUATORIAL_COMPETENCE_END
      ? buildCompetenceRange(
          value.EQUATORIAL_COMPETENCE_START,
          value.EQUATORIAL_COMPETENCE_END,
        )
      : listedCompetences.length > 0
        ? listedCompetences
        : value.EQUATORIAL_COMPETENCE
          ? [value.EQUATORIAL_COMPETENCE]
          : [];

  if (competences.length === 0 || competences.length > maxCompetencesPerRun) {
    throw new PocConfigurationError([competenceSource]);
  }

  return {
    portalUrl: value.EQUATORIAL_PORTAL_URL,
    apiUrl: value.EQUATORIAL_API_URL,
    document: value.EQUATORIAL_DOCUMENT,
    birthDate: value.EQUATORIAL_BIRTH_DATE,
    account: accounts[0] ?? '',
    accounts,
    competence: competences[0] ?? '',
    competences,
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
