import { afterEach, describe, expect, it } from 'vitest';

import { ApiRateLimitMiddleware } from '../src/api/api-rate-limit.middleware';

const originalClientMax = process.env.RATE_LIMIT_CLIENT_MAX;

afterEach(() => {
  if (originalClientMax === undefined) delete process.env.RATE_LIMIT_CLIENT_MAX;
  else process.env.RATE_LIMIT_CLIENT_MAX = originalClientMax;
});

describe('ApiRateLimitMiddleware', () => {
  it('bloqueia excesso de requisições e mantém health público', () => {
    process.env.RATE_LIMIT_CLIENT_MAX = '2';
    const middleware = new ApiRateLimitMiddleware();
    let nextCalls = 0;
    let statusCode: number | undefined;
    let payload: unknown;
    const response = {
      setHeader: () => undefined,
      status: (code: number) => {
        statusCode = code;
        return { json: (body: unknown) => { payload = body; } };
      },
    };
    const request = { originalUrl: '/api/v1/invoices', ip: '127.0.0.1', headers: {} };

    middleware.use(request, response, () => { nextCalls += 1; });
    middleware.use(request, response, () => { nextCalls += 1; });
    middleware.use(request, response, () => { nextCalls += 1; });
    expect(nextCalls).toBe(2);
    expect(statusCode).toBe(429);
    expect(payload).toMatchObject({ statusCode: 429 });

    middleware.use(
      { originalUrl: '/api/v1/health', ip: '127.0.0.1', headers: {} },
      response,
      () => { nextCalls += 1; },
    );
    expect(nextCalls).toBe(3);
  });
});
