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
        for (const clientId of clientIds) {
          await service.deleteClient(clientId);
        }
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

      await expect(
        service.setEquatorialCredentials(clientAId, {
          document: '00000000000',
          birthDate: '01/01/1990',
        }),
      ).resolves.toBe(true);
      expect(await service.getEquatorialCredentialStatus(clientAId)).toBe(true);
      const storedCredentials = await pool.query<{
        document_encrypted: string;
        birth_date_encrypted: string;
      }>(
        `SELECT document_encrypted, birth_date_encrypted
         FROM provider_credentials WHERE client_id = $1`,
        [clientAId],
      );
      expect(storedCredentials.rows[0]?.document_encrypted).not.toBe(
        '00000000000',
      );
      expect(storedCredentials.rows[0]?.birth_date_encrypted).not.toBe(
        '01/01/1990',
      );
      await expect(service.getEquatorialCredentialsForWorker(clientAId)).resolves.toEqual({
        document: '00000000000',
        birthDate: '01/01/1990',
      });

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
      expect(await service.deleteEquatorialCredentials(clientAId)).toBe(true);
      expect(await service.getEquatorialCredentialStatus(clientAId)).toBe(false);
    });

    it('reencaminha falhas temporárias e encerra ao atingir o limite de tentativas', async () => {
      const suffix = randomUUID().slice(0, 8);
      const client = await service.createClient({
        type: 'PF',
        name: `Cliente Retry ${suffix}`,
        document: '22222222222',
        birthDate: '01/01/1990',
      });
      const clientId = Number(client.id);
      clientIds.push(clientId);
      const account = `retry-${suffix}`;
      await service.addAccount(clientId, account);
      const sync = await service.createSync(clientId, [
        { account, competence: '2026/08' },
      ]);
      const syncId = sync?.syncId ?? '';

      const firstClaim = await service.claimNextQueuedSync(60_000);
      expect(firstClaim).toMatchObject({ id: syncId, attempts: 1 });
      expect(await service.recordOfflineSyncFailure(syncId, 2)).toBe('QUEUED');

      const secondClaim = await service.claimNextQueuedSync(60_000);
      expect(secondClaim).toMatchObject({ id: syncId, attempts: 2 });
      expect(await service.recordOfflineSyncFailure(syncId, 2)).toBe('FAILED');
      expect(await service.getSync(syncId, clientId)).toMatchObject({
        status: 'FAILED',
        failed: 1,
      });
      expect(await service.requeueFailedSync(syncId)).toBe(true);
      expect(await service.getSync(syncId, clientId)).toMatchObject({
        status: 'QUEUED',
        failed: 0,
      });
      expect(await service.requeueFailedSync(syncId)).toBe(false);
    });

    it('agenda mensalmente somente contas sem fatura ou trabalho pendente', async () => {
      const suffix = randomUUID().slice(0, 8);
      const client = await service.createClient({
        type: 'PJ',
        name: `Cliente Scheduler ${suffix}`,
        document: '33333333000133',
      });
      const clientId = Number(client.id);
      clientIds.push(clientId);
      const firstAccount = `schedule-a-${suffix}`;
      const secondAccount = `schedule-b-${suffix}`;
      await service.addAccount(clientId, firstAccount);
      await service.addAccount(clientId, secondAccount);

      const firstSchedule = await service.scheduleMonthlySyncs('2026/09');
      expect(firstSchedule.syncsCreated).toBeGreaterThanOrEqual(1);
      expect(firstSchedule.itemsCreated).toBeGreaterThanOrEqual(2);
      const ownRun = await pool.query<{ id: string }>(
        `SELECT id FROM sync_runs
         WHERE client_id = $1 AND status = 'QUEUED' AND total = 2
         ORDER BY created_at DESC LIMIT 1`,
        [clientId],
      );
      const syncId = ownRun.rows[0]?.id ?? '';
      expect(syncId).not.toBe('');
      expect(await service.scheduleMonthlySyncs('2026/09')).toMatchObject({
        syncsCreated: 0,
        itemsCreated: 0,
      });
      await service.processOfflineSync(syncId);
      expect(await service.scheduleMonthlySyncs('2026/09')).toMatchObject({
        syncsCreated: 0,
        itemsCreated: 0,
      });
      await expect(service.scheduleMonthlySyncs('09/2026')).rejects.toThrow(
        'Competência deve estar no formato AAAA/MM.',
      );
    });
  },
);
