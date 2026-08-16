import { Injectable, type NestMiddleware } from '@nestjs/common';

interface RateLimitRequest {
  originalUrl?: string;
  ip?: string;
  headers: { 'x-forwarded-for'?: string | string[] | undefined };
  socket?: { remoteAddress?: string | undefined };
}

interface RateLimitResponse {
  setHeader(name: string, value: string): void;
  status(code: number): { json(value: unknown): void };
}

interface Bucket {
  count: number;
  resetAt: number;
}

function positiveEnvironmentValue(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function requestIp(request: RateLimitRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (process.env.RATE_LIMIT_TRUST_PROXY === 'true' && forwarded) {
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return value?.split(',')[0]?.trim() || 'unknown';
  }
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}

@Injectable()
export class ApiRateLimitMiddleware implements NestMiddleware {
  private readonly buckets = new Map<string, Bucket>();

  use(request: RateLimitRequest, response: RateLimitResponse, next: () => void): void {
    const path = request.originalUrl?.split('?')[0] ?? '';
    if (path.endsWith('/health')) {
      next();
      return;
    }

    const admin = path.includes('/admin/') || path.includes('/clients');
    const windowMs = positiveEnvironmentValue('RATE_LIMIT_WINDOW_MS', 60_000);
    const maxRequests = positiveEnvironmentValue(
      admin ? 'RATE_LIMIT_ADMIN_MAX' : 'RATE_LIMIT_CLIENT_MAX',
      admin ? 60 : 120,
    );
    const now = Date.now();
    const key = `${admin ? 'admin' : 'client'}:${requestIp(request)}`;
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (this.buckets.size > 10_000) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }
    if (bucket.count <= maxRequests) {
      next();
      return;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    response.status(429).json({
      statusCode: 429,
      message: 'Limite de requisições excedido. Tente novamente mais tarde.',
    });
  }
}
