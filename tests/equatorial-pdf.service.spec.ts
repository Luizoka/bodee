import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('salva o PDF com conta e competência no nome', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 200]);
    const bytes = await source.save();
    const pdfService = new EquatorialPdfService();
    const pdf = await pdfService.decodeAndValidate(
      Buffer.from(bytes).toString('base64'),
    );
    const directory = await mkdtemp(join(tmpdir(), 'fatura-sync-'));

    try {
      const file = await pdfService.saveLocally(
        pdf,
        directory,
        '000003462412',
        '2026/08',
      );

      expect(file).toBe(
        join(directory, '2026-08', '000003462412_082026.pdf'),
      );
      await expect(readFile(file)).resolves.toEqual(pdf.buffer);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
