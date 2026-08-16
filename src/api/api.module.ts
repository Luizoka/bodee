import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Pool } from 'pg';

import { AdminApiKeyGuard, ClientApiKeyGuard } from './api-auth.guards';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { LocalInvoiceStorageService } from './local-invoice-storage.service';
import { ApiRateLimitMiddleware } from './api-rate-limit.middleware';

@Module({
  controllers: [ApiController],
  providers: [
    { provide: Pool, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) },
    {
      provide: ApiService,
      useFactory: (pool: Pool, storage: LocalInvoiceStorageService) =>
        new ApiService(
          pool,
          process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',
          storage,
        ),
      inject: [Pool, LocalInvoiceStorageService],
    },
    LocalInvoiceStorageService,
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
