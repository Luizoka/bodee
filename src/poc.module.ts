import { Module } from '@nestjs/common';

import { EquatorialApiService } from './providers/equatorial/equatorial-api.service';
import { EquatorialAuthService } from './providers/equatorial/equatorial-auth.service';
import { EquatorialPdfService } from './providers/equatorial/equatorial-pdf.service';
import { PocLogger } from './shared/logging/poc-logger';

@Module({
  providers: [
    EquatorialAuthService,
    EquatorialApiService,
    EquatorialPdfService,
    PocLogger,
  ],
  exports: [
    EquatorialAuthService,
    EquatorialApiService,
    EquatorialPdfService,
    PocLogger,
  ],
})
export class PocModule {}
