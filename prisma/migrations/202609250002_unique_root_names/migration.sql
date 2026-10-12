-- PostgreSQL treats NULL parent IDs as distinct in the Prisma composite unique constraint.
-- Root folders need their own uniqueness guard.
CREATE UNIQUE INDEX "FileEntry_ownerId_root_name_key"
ON "FileEntry" ("ownerId", "name")
WHERE "parentId" IS NULL;
