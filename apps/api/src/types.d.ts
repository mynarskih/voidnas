import type { PrismaClient, User } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance { prisma: PrismaClient }
  interface FastifyRequest { authUser: Pick<User, 'id' | 'username' | 'role' | 'enabled' | 'quotaBytes' | 'usedBytes' | 'language' | 'timeZone' | 'theme'> | null; sessionId: string | null }
}
