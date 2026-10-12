import { serialize } from './serialize.js';

const fields=new Set(['id','username','role','quotaBytes','usedBytes','enabled','createdAt','updatedAt','lastLogin','language','timeZone','theme']);
// Public DTO is an allowlist, never a complete Prisma record.
export function publicUser(user:object){
  return serialize(Object.fromEntries(Object.entries(user).filter(([key])=>fields.has(key))));
}
