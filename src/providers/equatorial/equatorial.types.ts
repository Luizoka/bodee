export interface EquatorialCredentials {
  document: string;
  birthDate: string;
}

export interface EquatorialAuthOptions {
  portalUrl: string;
  apiUrl: string;
  headless: boolean;
  timeoutMs: number;
  browserChannel: 'chrome' | 'chromium';
  persistentContext: boolean;
  userDataDirectory: string;
  diagnosticDirectory: string;
  maxAttempts?: number;
  retryDelaysMs?: number[];
  userAgent?: string;
  onOtpRequired?: () => void;
  onStage?: (stage: EquatorialAuthStage) => void;
  onNetworkEvent?: (event: EquatorialNetworkEvent) => void;
  onWaitingForForm?: (elapsedSeconds: number) => void;
  onWaitingForToken?: (elapsedSeconds: number) => void;
}

export type EquatorialLoginMode = 'birth_date' | 'otp';

export type EquatorialAuthStage =
  | 'portal_loaded'
  | 'scripts_ready'
  | 'form_ready'
  | 'otp_checked'
  | 'login_submitted'
  | 'authentication_received'
  | 'token_captured'
  | 'accounts_loaded'
  | 'api_context_ready'
  | 'session_ready'
  | 'retry_scheduled';

export type EquatorialNetworkEvent =
  | {
      type: 'request';
      method: string;
      path: string;
      postFieldNames: string[];
    }
  | {
      type: 'response';
      status: number;
      path: string;
      contentType: string;
    };

export interface EquatorialAccount {
  id: string;
  installationNumber?: string | undefined;
  maskedConsumerUnit?: string | undefined;
  address?: string | undefined;
  neighborhood?: string | undefined;
  city?: string | undefined;
}

export interface EquatorialAuthSession {
  accessToken: string;
  authenticatedAt: Date;
  loginMode: EquatorialLoginMode;
  cookieHeader: string;
  userAgent: string;
  portalOrigin: string;
  availableAccounts: string[];
  linkedAccounts: EquatorialAccount[];
}

export interface BrowserHttpResponse {
  status: number;
  body: unknown;
}

export interface ActiveEquatorialAuthSession extends EquatorialAuthSession {
  requestJsonFromBrowser(url: string): Promise<BrowserHttpResponse>;
  close(): Promise<void>;
}

export interface EquatorialLoginResult {
  session: ActiveEquatorialAuthSession;
  accounts: EquatorialAccount[];
}

export interface EquatorialInvoice {
  numeroFatura: string;
  competencia: string;
  valor?: string | undefined;
  dataVencimento?: string | undefined;
  dataPagamento?: string | null | undefined;
  codigoBarras?: string | undefined;
  notaFiscal?: string | undefined;
}

export interface ValidatedPdf {
  buffer: Buffer;
  pageCount: number;
  size: number;
  sha256: string;
}
