import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Pool } from 'pg';

import { AdminApiKeyGuard, ClientApiKeyGuard } from './api-auth.guards';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import {
  createInvoiceStorage,
  INVOICE_STORAGE,
} from './invoice-storage.factory';
import type { InvoiceStorage } from './invoice-storage';
import { ApiRateLimitMiddleware } from './api-rate-limit.middleware';

@Module({
  controllers: [ApiController],
  providers: [
    {
      provide: Pool,
      useFactory: () =>
        new Pool({ connectionString: process.env.DATABASE_URL }),
    },
    {
      provide: ApiService,
      useFactory: (pool: Pool, storage: InvoiceStorage) =>
        new ApiService(
          pool,
          process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',
          storage,
        ),
      inject: [Pool, INVOICE_STORAGE],
    },
    { provide: INVOICE_STORAGE, useFactory: createInvoiceStorage },
    AdminApiKeyGuard,
    ClientApiKeyGuard,
    ApiRateLimitMiddleware,
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ApiRateLimitMiddleware).forRoutes('*');
  }
}
