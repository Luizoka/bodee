import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { z } from 'zod';

import { ApiService } from './api.service';

@Controller()
export class ApiController {
  constructor(@Inject(ApiService) private readonly service: ApiService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Post('clients')
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
  async addAccount(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { account } = parseBody(
      z.object({ account: z.string().trim().min(1).max(64) }),
      body,
    );
    const accountRecord = await this.service.addAccount(id, account);
    if (!accountRecord) throw new NotFoundException('Cliente não encontrado.');
    return accountRecord;
  }

  @Post('sync')
  async createSync(@Body() body: unknown) {
    const input = parseBody(
      z.object({
        clientId: z.number().int().positive(),
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
    const sync = await this.service.createSync(input.clientId, items);
    if (!sync) throw new NotFoundException('Cliente não encontrado.');
    return sync;
  }

  @Get('sync/:id')
  async getSync(@Param('id') id: string) {
    const sync = await this.service.getSync(id);
    if (!sync) throw new NotFoundException('Sincronização não encontrada.');
    return sync;
  }

  @Get('invoices')
  listInvoices() {
    return this.service.listInvoices();
  }

  @Get('clients/:id/invoices')
  listClientInvoices(@Param('id', ParseIntPipe) id: number) {
    return this.service.listInvoices(id);
  }

  @Post('sync/:id/process-offline')
  @HttpCode(200)
  async processOffline(@Param('id') id: string) {
    const sync = await this.service.processOfflineSync(id);
    if (!sync) throw new NotFoundException('Sincronização não encontrada.');
    return sync;
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
