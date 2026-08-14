import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { EquatorialErrorCode } from '../src/providers/equatorial/equatorial.errors';
import { EquatorialPdfService } from '../src/providers/equatorial/equatorial-pdf.service';

describe('EquatorialPdfService', () => {
  it('decodifica e valida um PDF com página', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 200]);
    const bytes = await source.save();

    const result = await new EquatorialPdfService().decodeAndValidate(
      Buffer.from(bytes).toString('base64'),
    );

    expect(result.pageCount).toBe(1);
    expect(result.size).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('recusa Base64 malformado', async () => {
    await expect(
      new EquatorialPdfService().decodeAndValidate('not-base64'),
    ).rejects.toMatchObject({ code: EquatorialErrorCode.INVALID_BASE64 });
  });

  it('recusa conteúdo Base64 que não é PDF', async () => {
    await expect(
      new EquatorialPdfService().decodeAndValidate(
        Buffer.from('not a pdf').toString('base64'),
      ),
    ).rejects.toMatchObject({ code: EquatorialErrorCode.INVALID_PDF });
  });
});
