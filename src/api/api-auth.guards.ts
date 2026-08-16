import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { ApiService } from './api.service';

interface HttpRequest {
  headers: { authorization?: string | undefined };
}

export interface AuthenticatedRequest extends HttpRequest {
  authenticatedClientId?: number;
}

function readBearerToken(request: HttpRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token || undefined;
}

function safelyMatches(value: string, expected: string): boolean {
  const received = Buffer.from(value);
  const target = Buffer.from(expected);
  return (
    received.length === target.length && timingSafeEqual(received, target)
  );
}

@Injectable()
export class ClientApiKeyGuard implements CanActivate {
  constructor(@Inject(ApiService) private readonly service: ApiService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request);
    if (!token) throw new UnauthorizedException('API key ausente ou inválida.');

    const clientId = await this.service.authenticateApiKey(token);
    if (!clientId) {
      throw new UnauthorizedException('API key ausente ou inválida.');
    }
    request.authenticatedClientId = clientId;
    return true;
  }
}

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const token = readBearerToken(request);
    const expected = process.env.ADMIN_API_KEY;
    if (!token || !expected || !safelyMatches(token, expected)) {
      throw new UnauthorizedException('Chave de administração ausente ou inválida.');
    }
    return true;
  }
}

export function getAuthenticatedClientId(request: AuthenticatedRequest): number {
  if (!request.authenticatedClientId) {
    throw new UnauthorizedException('API key ausente ou inválida.');
  }
  return request.authenticatedClientId;
}
