import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import {
  AdminApiKeyGuard,
  ClientApiKeyGuard,
  getAuthenticatedClientId,
  type AuthenticatedRequest,
} from './api-auth.guards';
import { ApiService } from './api.service';

@Controller()
export class ApiController {
  constructor(@Inject(ApiService) private readonly service: ApiService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Post('clients')
  @UseGuards(AdminApiKeyGuard)
  createClient(@Body() body: unknown) {
    const input = parseBody(
      z
        .object({
          type: z.enum(['PF', 'PJ']),
          name: z.string().trim().min(1).max(200),
          document: z.string().trim().min(11).max(18),
          birthDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
          email: z.email().optional(),
        })
        .superRefine((value, context) => {
          if (value.type === 'PF' && !value.birthDate) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['birthDate'],
              message: 'Obrigatória para pessoa física.',
            });
          }
          if (value.type === 'PJ' && !value.email) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['email'],
              message: 'Obrigatório para pessoa jurídica.',
            });
          }
        }),
      body,
    );
    return this.service.createClient(input);
  }

  @Post('clients/:id/accounts')
  @UseGuards(AdminApiKeyGuard)
  async addAccount(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { account } = parseBody(
      z.object({ account: z.string().trim().min(1).max(64) }),
      body,
    );
    const accountRecord = await this.service.addAccount(id, account);
    if (!accountRecord) throw new NotFoundException('Cliente não encontrado.');
    return accountRecord;
  }

  @Delete('clients/:id')
  @UseGuards(AdminApiKeyGuard)
  async deleteClient(@Param('id', ParseIntPipe) id: number) {
    const deleted = await this.service.deleteClient(id);
    if (!deleted) throw new NotFoundException('Cliente não encontrado.');
    return { deleted: true };
  }

  @Post('clients/:id/api-keys')
  @UseGuards(AdminApiKeyGuard)
  async createClientApiKey(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const { label } = parseBody(
      z.object({ label: z.string().trim().min(1).max(120) }),
      body,
    );
    const apiKey = await this.service.createClientApiKey(id, label);
    if (!apiKey) throw new NotFoundException('Cliente não encontrado.');
    return apiKey;
  }

  @Delete('clients/:clientId/api-keys/:keyId')
  @UseGuards(AdminApiKeyGuard)
  async revokeClientApiKey(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('keyId') keyId: string,
  ) {
    const revoked = await this.service.revokeClientApiKey(clientId, keyId);
    if (!revoked) throw new NotFoundException('API key não encontrada.');
    return { revoked: true };
  }

  @Post('sync')
  @UseGuards(ClientApiKeyGuard)
  createSync(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseBody(
      z.object({
        accounts: z
          .array(
            z.object({
              account: z.string().trim().min(1).max(64),
              competences: z
                .array(z.string().regex(/^\d{4}\/(0[1-9]|1[0-2])$/))
                .min(1),
            }),
          )
          .min(1),
      }),
      body,
    );
    const items = input.accounts.flatMap(({ account, competences }) =>
      competences.map((competence) => ({ account, competence })),
    );
    return this.service.createSync(getAuthenticatedClientId(request), items);
  }

  @Get('sync/:id')
  @UseGuards(ClientApiKeyGuard)
  async getSync(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const sync = await this.service.getSync(
      id,
      getAuthenticatedClientId(request),
    );
    if (!sync) throw new NotFoundException('Sincronização não encontrada.');
    return sync;
  }

  @Get('invoices')
  @UseGuards(ClientApiKeyGuard)
  listInvoices(@Req() request: AuthenticatedRequest) {
    return this.service.listInvoices(getAuthenticatedClientId(request));
  }
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new BadRequestException({
    message: 'Corpo da requisição inválido.',
    errors: result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
