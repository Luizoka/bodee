export const EquatorialErrorCode = {
  AUTH_FORM_UNAVAILABLE: 'AUTH_FORM_UNAVAILABLE',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TIMEOUT: 'AUTH_TIMEOUT',
  CAPTCHA_REJECTED: 'CAPTCHA_REJECTED',
  TOKEN_NOT_FOUND: 'TOKEN_NOT_FOUND',
  PORTAL_UNAVAILABLE: 'PORTAL_UNAVAILABLE',
  PORTAL_BLOCKED: 'PORTAL_BLOCKED',
  API_TIMEOUT: 'API_TIMEOUT',
  API_UNAUTHORIZED: 'API_UNAUTHORIZED',
  API_BLOCKED: 'API_BLOCKED',
  API_SERVER_ERROR: 'API_SERVER_ERROR',
  API_INVALID_RESPONSE: 'API_INVALID_RESPONSE',
  API_ERROR: 'API_ERROR',
  INVOICE_NOT_AVAILABLE: 'INVOICE_NOT_AVAILABLE',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  INVALID_BASE64: 'INVALID_BASE64',
  INVALID_PDF: 'INVALID_PDF',
} as const;

export type EquatorialErrorCode =
  (typeof EquatorialErrorCode)[keyof typeof EquatorialErrorCode];

export class EquatorialError extends Error {
  constructor(
    public readonly code: EquatorialErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EquatorialError';
  }
}
