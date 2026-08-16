import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';

@Module({
  controllers: [ApiController],
  providers: [
    { provide: Pool, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) },
    {
      provide: ApiService,
      useFactory: (pool: Pool) => new ApiService(pool, process.env.CREDENTIALS_ENCRYPTION_KEY ?? ''),
      inject: [Pool],
    },
  ],
})
export class ApiModule {}
