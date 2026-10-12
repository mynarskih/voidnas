-- Trashed entries may keep their old names without blocking a replacement.
-- Restore still fails safely when an active entry already uses that name.
DROP INDEX "FileEntry_ownerId_parentId_name_key";
DROP INDEX "FileEntry_ownerId_root_name_key";
CREATE UNIQUE INDEX "FileEntry_active_child_name_key"
ON "FileEntry" ("ownerId", "parentId", "name")
WHERE "deletedAt" IS NULL AND "parentId" IS NOT NULL;
CREATE UNIQUE INDEX "FileEntry_active_root_name_key"
ON "FileEntry" ("ownerId", "name")
WHERE "deletedAt" IS NULL AND "parentId" IS NULL;
