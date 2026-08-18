import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';

import type {
  InvoiceStorage,
  InvoiceStorageReference,
} from './invoice-storage';

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

@Injectable()
export class LocalInvoiceStorageService implements InvoiceStorage {
  private readonly rootDirectory = resolve(
    process.cwd(),
    process.env.INVOICE_STORAGE_DIR ?? 'output/invoices',
  );

  async save(
    clientId: number,
    account: string,
    competence: string,
    content: Buffer,
  ): Promise<InvoiceStorageReference> {
    const safeAccount = safePathSegment(account);
    const safeCompetence = safePathSegment(competence.replace('/', '-'));
    const directory = join(this.rootDirectory, String(clientId), safeAccount);
    const filename = `${safeAccount}_${safeCompetence}.pdf`;
    const filePath = join(directory, filename);
    const temporary = join(directory, `.${filename}.${randomUUID()}.tmp`);

    await mkdir(directory, { recursive: true });
    try {
      await access(filePath);
      return { provider: 'local', filePath, filename };
    } catch {
      // Arquivo ainda não existe.
    }

    await writeFile(temporary, content, { flag: 'wx' });
    try {
      await rename(temporary, filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { provider: 'local', filePath, filename };
  }

  async get(
    reference: InvoiceStorageReference,
  ): Promise<{ content: Buffer; filename: string }> {
    const filePath = reference.filePath;
    if (!filePath) throw new Error('Referência de arquivo local inválida.');
    const resolvedPath = resolve(filePath);
    const pathWithinRoot = relative(this.rootDirectory, resolvedPath);
    if (pathWithinRoot.startsWith('..') || pathWithinRoot === '') {
      throw new Error('Caminho de fatura inválido.');
    }
    return {
      content: await readFile(resolvedPath),
      filename: basename(resolvedPath),
    };
  }

  async delete(reference: InvoiceStorageReference): Promise<void> {
    if (reference.filePath) await rm(reference.filePath, { force: true });
  }

  async removeClientFiles(clientId: number): Promise<void> {
    await rm(join(this.rootDirectory, String(clientId)), {
      recursive: true,
      force: true,
    });
  }
}
