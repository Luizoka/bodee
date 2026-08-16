import { Module } from '@nestjs/common';
import { Pool } from 'pg';

import { AdminApiKeyGuard, ClientApiKeyGuard } from './api-auth.guards';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { LocalInvoiceStorageService } from './local-invoice-storage.service';

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
  ],
})
export class ApiModule {}
