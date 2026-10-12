import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import { randomToken } from './security.js';

export const passwordOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
const dummy = argon2.hash(randomToken(), passwordOptions);
const WINDOW = 15 * 60_000;

// Account-bound, persistent throttling cannot be bypassed by changing source IP.
export async function authenticate(db: PrismaClient, username: string, password: string) {
  const account = await db.user.findUnique({ where: { username }, select: { id: true } });
  if (!account) { await argon2.verify(await dummy, password); return null; }
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${account.id}, 0))`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: account.id } });
    const key = `login-throttle:${account.id}`;
    const stored = (await tx.systemSetting.findUnique({ where: { key } }))?.value as { start?: number; failures?: number } | undefined;
    const now = Date.now();
    const start = typeof stored?.start === 'number' && now - stored.start < WINDOW ? stored.start : now;
    const failures = start === stored?.start && Number.isInteger(stored.failures) ? Math.max(0, stored.failures!) : 0;
    const locked = failures >= 8;
    const valid = await argon2.verify(user.enabled && !locked ? user.passwordHash : await dummy, password).catch(() => false);
    if (!user.enabled || locked || !valid) {
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: { start, failures: Math.min(failures + 1, 8) } }, update: { value: { start, failures: Math.min(failures + 1, 8) } } });
      return null;
    }
    await tx.systemSetting.deleteMany({ where: { key } });
    return user;
  }, { timeout: 15000 });
}
