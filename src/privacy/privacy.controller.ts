import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { privacyPageHtml } from './privacy-page';

@Controller('privacy')
@ApiExcludeController()
export class PrivacyController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  page(): string {
    return privacyPageHtml;
  }
}
