const sensitiveKey =
  /(token|authorization|password|senha|credential|document|cpf|cnpj|base64)/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : sanitize(item),
    ]),
  );
}

export class PocLogger {
  info(event: string, metadata: Record<string, unknown> = {}): void {
    const safeMetadata = sanitize(metadata) as Record<string, unknown>;
    process.stdout.write(
      `${JSON.stringify({ level: 'info', event, ...safeMetadata })}\n`,
    );
  }

  error(event: string, metadata: Record<string, unknown> = {}): void {
    const safeMetadata = sanitize(metadata) as Record<string, unknown>;
    process.stderr.write(
      `${JSON.stringify({ level: 'error', event, ...safeMetadata })}\n`,
    );
  }
}

export function sanitizeForLog(value: unknown): unknown {
  return sanitize(value);
}
