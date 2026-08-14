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
  onOtpRequired?: () => void;
  onStage?: (stage: EquatorialAuthStage) => void;
  onWaitingForForm?: (elapsedSeconds: number) => void;
  onWaitingForToken?: (elapsedSeconds: number) => void;
}

export type EquatorialLoginMode = 'birth_date' | 'otp';

export type EquatorialAuthStage =
  | 'portal_loaded'
  | 'form_ready'
  | 'login_submitted'
  | 'token_captured'
  | 'api_context_ready'
  | 'session_ready';

export interface EquatorialAuthSession {
  accessToken: string;
  authenticatedAt: Date;
  loginMode: EquatorialLoginMode;
  cookieHeader: string;
  userAgent: string;
  portalOrigin: string;
}

export interface BrowserHttpResponse {
  status: number;
  body: unknown;
}

export interface ActiveEquatorialAuthSession extends EquatorialAuthSession {
  requestJsonFromBrowser(url: string): Promise<BrowserHttpResponse>;
  close(): Promise<void>;
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
