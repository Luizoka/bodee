import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

import { EquatorialError, EquatorialErrorCode } from './equatorial.errors';
import type { ValidatedPdf } from './equatorial.types';

function cleanBase64(value: string): string {
  const trimmed = value.trim();
  const payload = trimmed.startsWith('data:')
    ? (trimmed.split(',', 2)[1] ?? '')
    : trimmed;

  return payload.replace(/\s/g, '');
}

@Injectable()
export class EquatorialPdfService {
  async decodeAndValidate(base64: string): Promise<ValidatedPdf> {
    const cleaned = cleanBase64(base64);

    if (
      !cleaned ||
      cleaned.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)
    ) {
      throw new EquatorialError(
        EquatorialErrorCode.INVALID_BASE64,
        'O conteúdo recebido não é um Base64 válido.',
        false,
      );
    }

    const buffer = Buffer.from(cleaned, 'base64');
    if (buffer.length === 0 || buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw new EquatorialError(
        EquatorialErrorCode.INVALID_PDF,
        'O arquivo recebido não possui assinatura PDF.',
        false,
      );
    }

    try {
      const document = await PDFDocument.load(buffer);
      const pageCount = document.getPageCount();

      if (pageCount < 1) {
        throw new Error('PDF sem páginas');
      }

      return {
        buffer,
        pageCount,
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
    } catch (error) {
      throw new EquatorialError(
        EquatorialErrorCode.INVALID_PDF,
        'O arquivo recebido não pôde ser aberto como PDF.',
        false,
        { cause: error },
      );
    }
  }

  async saveLocally(
    pdf: ValidatedPdf,
    outputDirectory: string,
    account: string,
    competence: string,
  ): Promise<string> {
    const competenceDirectory = competence.replace('/', '-');
    const directory = join(outputDirectory, competenceDirectory);
    const monthYear = competence.replace(/^(\d{4})\/(\d{2})$/, '$2$1');
    const filename = `${account}_${monthYear}.pdf`;
    const target = join(directory, filename);
    const temporary = join(directory, `.${filename}.${randomUUID()}.tmp`);

    await mkdir(directory, { recursive: true });

    // O caminho é estável por conta e competência; se já existe uma fatura
    // para essa combinação, não há motivo para sobrescrevê-la.
    try {
      await access(target);
      return target;
    } catch {
      // Primeiro download desta versão do arquivo.
    }

    await writeFile(temporary, pdf.buffer, { flag: 'wx' });
    try {
      await rename(temporary, target);
    } catch (error) {
      // Outra execução pode ter concluído o mesmo arquivo entre o access e o
      // rename. Nesse caso, o arquivo existente continua sendo válido.
      try {
        await access(target);
        await unlink(temporary).catch(() => undefined);
        return target;
      } catch {
        throw error;
      }
    }

    return target;
  }
}
