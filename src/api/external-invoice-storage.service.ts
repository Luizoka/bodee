import type {
  InvoiceStorage,
  InvoiceStorageReference,
} from './invoice-storage';

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class ExternalInvoiceStorageService implements InvoiceStorage {
  constructor(
    private readonly url = process.env.SUPABASE_URL ?? '',
    private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ??
      '',
    private readonly bucket = process.env.SUPABASE_INVOICE_BUCKET ?? 'faturas',
  ) {
    if (!url || !this.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias para INVOICE_STORAGE_PROVIDER=supabase.',
      );
    }
  }

  private objectUrl(bucket: string, path: string): string {
    return `${this.url.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  private headers(contentType?: string): HeadersInit {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    };
  }

  async save(
    clientId: number,
    account: string,
    competence: string,
    content: Buffer,
  ): Promise<InvoiceStorageReference> {
    const [year, month] = competence.split('/');
    if (!year || !month) throw new Error('Competência de fatura inválida.');
    const path = `clients/${clientId}/equatorial/${safePathSegment(account)}/${year}/${month}/invoice.pdf`;
    const response = await fetch(this.objectUrl(this.bucket, path), {
      method: 'POST',
      headers: { ...this.headers('application/pdf'), 'x-upsert': 'true' },
      body: new Uint8Array(content),
    });
    if (!response.ok)
      throw new Error(
        `Não foi possível salvar a fatura no storage externo (HTTP ${response.status}).`,
      );
    return {
      provider: 'supabase',
      bucket: this.bucket,
      storagePath: path,
      filename: `${safePathSegment(account)}_${year}-${month}.pdf`,
    };
  }

  async get(
    reference: InvoiceStorageReference,
  ): Promise<{ content: Buffer; filename: string }> {
    if (!reference.bucket || !reference.storagePath)
      throw new Error('Referência de storage externo inválida.');
    const response = await fetch(
      this.objectUrl(reference.bucket, reference.storagePath),
      {
        headers: this.headers(),
      },
    );
    if (!response.ok)
      throw new Error(
        `Não foi possível obter a fatura no storage externo (HTTP ${response.status}).`,
      );
    return {
      content: Buffer.from(await response.arrayBuffer()),
      filename: reference.filename,
    };
  }

  async delete(reference: InvoiceStorageReference): Promise<void> {
    if (!reference.bucket || !reference.storagePath) return;
    const response = await fetch(
      `${this.url.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(reference.bucket)}`,
      {
        method: 'DELETE',
        headers: { ...this.headers('application/json') },
        body: JSON.stringify({ prefixes: [reference.storagePath] }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Não foi possível remover a fatura no storage externo (HTTP ${response.status}).`,
      );
  }
}
