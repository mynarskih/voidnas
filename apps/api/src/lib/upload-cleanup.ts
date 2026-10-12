import type { PrismaClient } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { assertUserStorageDirectories } from './storage-boundary.js';
import { resolveInside } from './security.js';

export async function cleanupExpiredUploads(db: PrismaClient, root: string) {
  const eligible = { writing: false, OR: [{ status: 'ACTIVE' as const, expiresAt: { lt: new Date() } }, { status: { in: ['CANCELLED' as const, 'FAILED' as const] } }] };
  const candidates = await db.uploadSession.findMany({ where: eligible });
  for (const upload of candidates) {
    // Recheck under the SAME lock as renewal, so cleanup cannot remove an active writer.
    const claimed = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${upload.userId}, 0))`;
      return tx.uploadSession.updateMany({ where: { id: upload.id, ...eligible }, data: { status: 'FAILED' } });
    });
    if (!claimed.count) continue;
    await assertUserStorageDirectories(root, upload.userId);
    await rm(resolveInside(root, upload.temporaryPath), { force: true });
    // Never release quota until temporary bytes have actually been removed.
    await db.storageReservation.deleteMany({ where: { uploadSessionId: upload.id } });
  }
}
