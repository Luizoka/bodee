import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { ApiService } from '../src/api/api.service';

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

describe.skipIf(!databaseUrl || !encryptionKey)(
  'segurança da API com PostgreSQL local',
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const service = new ApiService(pool, encryptionKey ?? '');
    const clientIds: number[] = [];

    beforeAll(async () => {
      await service.initialize();
    });

    afterAll(async () => {
      if (clientIds.length > 0) {
        await pool.query('DELETE FROM sync_runs WHERE client_id = ANY($1::bigint[])', [
          clientIds,
        ]);
        await pool.query('DELETE FROM invoices WHERE client_id = ANY($1::bigint[])', [
          clientIds,
        ]);
        await pool.query('DELETE FROM clients WHERE id = ANY($1::bigint[])', [
          clientIds,
        ]);
      }
      await pool.end();
    });

    it('vincula a API key a um cliente e impede acesso de outro cliente', async () => {
      const suffix = randomUUID().slice(0, 8);
      const clientA = await service.createClient({
        type: 'PF',
        name: `Cliente A ${suffix}`,
        document: '00000000000',
        birthDate: '01/01/1990',
      });
      const clientB = await service.createClient({
        type: 'PF',
        name: `Cliente B ${suffix}`,
        document: '11111111111',
        birthDate: '01/01/1990',
      });
      const clientAId = Number(clientA.id);
      const clientBId = Number(clientB.id);
      clientIds.push(clientAId, clientBId);

      const account = `test-${suffix}`;
      await service.addAccount(clientAId, account);
      const key = await service.createClientApiKey(clientAId, 'teste automatizado');
      expect(key?.apiKey).toMatch(/^fsk_/);
      expect(await service.authenticateApiKey(key?.apiKey ?? '')).toBe(clientAId);

      const sync = await service.createSync(clientAId, [
        { account, competence: '2026/08' },
      ]);
      expect(sync?.status).toBe('QUEUED');

      expect(await service.getSync(sync?.syncId ?? '', clientAId)).toMatchObject({
        id: sync?.syncId,
      });
      expect(await service.getSync(sync?.syncId ?? '', clientBId)).toBeUndefined();

      await service.processOfflineSync(sync?.syncId ?? '');
      expect(await service.listInvoices(clientAId)).toHaveLength(1);
      expect(await service.listInvoices(clientBId)).toHaveLength(0);

      expect(
        await service.revokeClientApiKey(clientAId, key?.id ?? ''),
      ).toBe(true);
      expect(await service.authenticateApiKey(key?.apiKey ?? '')).toBeUndefined();
    });
  },
);
