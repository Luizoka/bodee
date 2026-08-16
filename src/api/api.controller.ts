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
  Put,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import {
  AdminApiKeyGuard,
  ClientApiKeyGuard,
  getAuthenticatedClientId,
  type AuthenticatedRequest,
} from './api-auth.guards';
import { ApiService } from './api.service';

@Controller()
@ApiTags('FaturaSync')
export class ApiController {
  constructor(@Inject(ApiService) private readonly service: ApiService) {}

  @Get('health')
  @ApiOperation({ summary: 'Verifica se a API e o banco estão disponíveis' })
  health() {
    return this.service.health();
  }

  @Post('clients')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Cria um cliente' })
  @ApiBody({
    schema: {
      example: {
        type: 'PF', name: 'Maria Silva', document: '00000000000', birthDate: '01/01/1990',
      },
    },
  })
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
    return this.service.createClient(input).then(async (client) => {
      await this.service.recordAuditLog('ADMIN', 'client.created', 'client', {
        resourceId: client.id,
      });
      return client;
    });
  }

  @Post('clients/:id/accounts')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Associa uma conta contrato ao cliente' })
  @ApiParam({ name: 'id', type: Number })
  async addAccount(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { account } = parseBody(
      z.object({ account: z.string().trim().min(1).max(64) }),
      body,
    );
    const accountRecord = await this.service.addAccount(id, account);
    if (!accountRecord) throw new NotFoundException('Cliente não encontrado.');
    await this.service.recordAuditLog('ADMIN', 'client.account_added', 'account', {
      resourceId: accountRecord.id,
      details: { clientId: id },
    });
    return accountRecord;
  }

  @Delete('clients/:id')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Remove cliente, dados e arquivos associados' })
  @ApiParam({ name: 'id', type: Number })
  async deleteClient(@Param('id', ParseIntPipe) id: number) {
    const deleted = await this.service.deleteClient(id);
    if (!deleted) throw new NotFoundException('Cliente não encontrado.');
    await this.service.recordAuditLog('ADMIN', 'client.deleted', 'client', {
      resourceId: id,
    });
    return { deleted: true };
  }

  @Put('clients/:id/providers/equatorial/credentials')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Configura credenciais criptografadas da Equatorial' })
  @ApiParam({ name: 'id', type: Number })
  async setEquatorialCredentials(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const credentials = parseBody(
      z.object({
        document: z.string().trim().min(11).max(18),
        birthDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
      }),
      body,
    );
    const configured = await this.service.setEquatorialCredentials(
      id,
      credentials,
    );
    if (!configured) throw new NotFoundException('Cliente não encontrado.');
    await this.service.recordAuditLog(
      'ADMIN',
      'equatorial_credentials.configured',
      'provider_credentials',
      { resourceId: id, details: { clientId: id } },
    );
    return { configured: true };
  }

  @Get('clients/:id/providers/equatorial/credentials/status')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Informa se as credenciais Equatorial estão configuradas' })
  @ApiParam({ name: 'id', type: Number })
  async getEquatorialCredentialStatus(@Param('id', ParseIntPipe) id: number) {
    return { configured: await this.service.getEquatorialCredentialStatus(id) };
  }

  @Delete('clients/:id/providers/equatorial/credentials')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Remove credenciais Equatorial' })
  @ApiParam({ name: 'id', type: Number })
  async deleteEquatorialCredentials(@Param('id', ParseIntPipe) id: number) {
    const deleted = await this.service.deleteEquatorialCredentials(id);
    if (!deleted) throw new NotFoundException('Credenciais não encontradas.');
    await this.service.recordAuditLog(
      'ADMIN',
      'equatorial_credentials.deleted',
      'provider_credentials',
      { resourceId: id, details: { clientId: id } },
    );
    return { deleted: true };
  }

  @Post('clients/:id/api-keys')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Emite API key de cliente (exibida somente uma vez)' })
  @ApiParam({ name: 'id', type: Number })
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
    await this.service.recordAuditLog('ADMIN', 'api_key.created', 'api_key', {
      resourceId: apiKey.id,
      details: { clientId: id, keyPrefix: apiKey.key_prefix },
    });
    return apiKey;
  }

  @Delete('clients/:clientId/api-keys/:keyId')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Revoga API key de cliente' })
  @ApiParam({ name: 'clientId', type: Number })
  @ApiParam({ name: 'keyId', type: String })
  async revokeClientApiKey(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('keyId') keyId: string,
  ) {
    const revoked = await this.service.revokeClientApiKey(clientId, keyId);
    if (!revoked) throw new NotFoundException('API key não encontrada.');
    await this.service.recordAuditLog('ADMIN', 'api_key.revoked', 'api_key', {
      resourceId: keyId,
      details: { clientId },
    });
    return { revoked: true };
  }

  @Get('admin/audit-logs')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Lista eventos de auditoria sem expor segredos' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listAuditLogs(@Query() query: unknown) {
    const { limit } = parseBody(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
      query,
    );
    return this.service.listAuditLogs(limit);
  }

  @Get('admin/sync-runs')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Lista execuções da fila administrativa' })
  @ApiQuery({ name: 'status', required: false, enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listAdminSyncRuns(@Query() query: unknown) {
    const input = parseBody(
      z.object({
        status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      query,
    );
    return this.service.listAdminSyncRuns(input.status, input.limit);
  }

  @Post('admin/sync-runs/:id/requeue')
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth('adminApiKey')
  @ApiOperation({ summary: 'Devolve uma execução FAILED para a fila' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async requeueFailedSync(@Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) {
      throw new BadRequestException('Id de sincronização inválido.');
    }
    const requeued = await this.service.requeueFailedSync(id);
    if (!requeued) {
      throw new NotFoundException('Sincronização falha não encontrada.');
    }
    await this.service.recordAuditLog('ADMIN', 'sync.requeued', 'sync_run', {
      resourceId: id,
    });
    return { requeued: true };
  }

  @Post('sync')
  @UseGuards(ClientApiKeyGuard)
  @ApiBearerAuth('clientApiKey')
  @ApiOperation({ summary: 'Solicita sincronização das contas do cliente autenticado' })
  @ApiBody({
    schema: {
      example: { accounts: [{ account: '000003462412', competences: ['2026/08'] }] },
    },
  })
  async createSync(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
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
    const clientId = getAuthenticatedClientId(request);
    const sync = await this.service.createSync(clientId, items);
    if (sync) {
      await this.service.recordAuditLog('CLIENT', 'sync.requested', 'sync_run', {
        actorClientId: clientId,
        resourceId: sync.syncId,
        details: { total: sync.total },
      });
    }
    return sync;
  }

  @Get('sync/:id')
  @UseGuards(ClientApiKeyGuard)
  @ApiBearerAuth('clientApiKey')
  @ApiOperation({ summary: 'Consulta sincronização do cliente autenticado' })
  @ApiParam({ name: 'id', format: 'uuid' })
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
  @ApiBearerAuth('clientApiKey')
  @ApiOperation({ summary: 'Lista faturas do cliente autenticado' })
  listInvoices(@Req() request: AuthenticatedRequest) {
    return this.service.listInvoices(getAuthenticatedClientId(request));
  }

  @Get('invoices/:id/download')
  @UseGuards(ClientApiKeyGuard)
  @ApiBearerAuth('clientApiKey')
  @ApiOperation({ summary: 'Baixa PDF privado de uma fatura' })
  @ApiParam({ name: 'id', type: Number })
  async downloadInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const invoice = await this.service.getInvoiceDownload(
      id,
      getAuthenticatedClientId(request),
    );
    if (!invoice) throw new NotFoundException('Fatura não encontrada.');
    return new StreamableFile(invoice.content, {
      type: 'application/pdf',
      disposition: `attachment; filename="${invoice.filename}"`,
    });
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
