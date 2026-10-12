import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export async function audit(prisma: PrismaClient, request: FastifyRequest, action: string, result: 'SUCCESS' | 'FAILED', resourceId?: string, metadata?: Record<string, unknown>) {
  await prisma.auditLog.create({ data: { userId: request.authUser?.id, action, result, resourceId, ip: request.ip, metadata: metadata as never } }).catch(() => request.log?.warn({ action }, 'Audit persistence unavailable'));
}
