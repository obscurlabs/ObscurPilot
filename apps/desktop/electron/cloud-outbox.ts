import { resolve } from 'node:path';
import {
  CloudRepositoryError,
  type CloudRepository,
} from '@obscurpilot/adapters-supabase/boundary';
import {
  BoundedDurableOutbox,
  type OutboxPersistence,
  type StoredOutboxEvent,
} from '@obscurpilot/domain/durable-outbox';
import { z } from 'zod';
import { EncryptedJsonStore, type EncryptionProvider } from './encrypted-json-store.js';

const StoredOutboxEventSchema = z
  .object({
    id: z.string().min(1).max(128),
    idempotencyKey: z.string().uuid(),
    tenantId: z.string().uuid(),
    aggregateId: z.string().min(1).max(128),
    schemaVersion: z.number().int().positive(),
    eventType: z.string().min(1).max(96),
    occurredAt: z.string().datetime({ offset: true }),
    payload: z.record(z.string(), z.unknown()),
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: z.string().datetime({ offset: true }),
  })
  .strict();
const StoredOutboxSchema = z.array(StoredOutboxEventSchema).max(512);
const ProfileMutationSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    displayName: z.string().min(1).max(80),
    locale: z.string().min(2).max(35),
    timeZone: z.string().min(1).max(64),
  })
  .strict();

class EncryptedOutboxPersistence implements OutboxPersistence {
  private readonly store: EncryptedJsonStore<StoredOutboxEvent[]>;

  public constructor(userDataPath: string, encryption: EncryptionProvider) {
    this.store = new EncryptedJsonStore(
      resolve(userDataPath, 'cloud-outbox.enc'),
      StoredOutboxSchema,
      () => [],
      encryption,
    );
  }

  public load(): Promise<readonly StoredOutboxEvent[]> {
    return this.store.load();
  }

  public save(events: readonly StoredOutboxEvent[]): Promise<void> {
    return this.store.save([...events]);
  }
}

export function createCloudOutbox(
  userDataPath: string,
  repository: CloudRepository,
  getCurrentUserId: () => string | undefined,
  encryption: EncryptionProvider,
): BoundedDurableOutbox {
  return new BoundedDurableOutbox(
    new EncryptedOutboxPersistence(userDataPath, encryption),
    {
      deliver: async (event) => {
        if (getCurrentUserId() !== event.tenantId) {
          return 'deferred';
        }
        if (event.eventType !== 'profile.update') {
          throw new Error('Unsupported durable mutation type');
        }
        const payload = ProfileMutationSchema.parse(event.payload);
        try {
          await repository.updateProfile({
            mutationId: event.idempotencyKey,
            expectedRevision: payload.expectedRevision,
            displayName: payload.displayName,
            locale: payload.locale,
            timeZone: payload.timeZone,
          });
        } catch (error: unknown) {
          if (error instanceof CloudRepositoryError && !error.retryable) return 'rejected';
          throw error;
        }
        return 'delivered';
      },
    },
    { maxEvents: 512, maxSerializedBytes: 4 * 1024 * 1024 },
  );
}
