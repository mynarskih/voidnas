-- Additive migration: retain accounts, files and existing sessions/uploads.
ALTER TABLE "Session" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UploadSession" ADD COLUMN "initiatedById" UUID;
CREATE TABLE "PublicLink" (
  "id" UUID NOT NULL, "ownerId" UUID NOT NULL, "fileId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL, "passwordHash" TEXT, "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PublicLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PublicLink_tokenHash_key" ON "PublicLink"("tokenHash");
CREATE INDEX "PublicLink_ownerId_createdAt_idx" ON "PublicLink"("ownerId", "createdAt");
CREATE TABLE "PublicLinkGrant" (
  "id" UUID NOT NULL, "linkId" UUID NOT NULL, "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicLinkGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicLinkGrant_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PublicLink"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PublicLinkGrant_tokenHash_key" ON "PublicLinkGrant"("tokenHash");
CREATE INDEX "PublicLinkGrant_linkId_expiresAt_idx" ON "PublicLinkGrant"("linkId", "expiresAt");
CREATE TABLE "AdminAlert" (
  "id" UUID NOT NULL, "key" VARCHAR(128) NOT NULL, "code" VARCHAR(64) NOT NULL,
  "severity" VARCHAR(16) NOT NULL, "message" VARCHAR(512) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "acknowledgedAt" TIMESTAMP(3), "resolvedAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminAlert_key_key" ON "AdminAlert"("key");
CREATE INDEX "AdminAlert_active_lastSeenAt_idx" ON "AdminAlert"("active", "lastSeenAt");
