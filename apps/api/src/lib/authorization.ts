import { type Prisma, type PrismaClient, type FileEntry } from '@prisma/client';

export type Db = Prisma.TransactionClient | PrismaClient;
export const inaccessible = () => Object.assign(new Error('File or folder not found'), { statusCode: 404 });
export async function ancestorIds(db: Db, item: Pick<FileEntry, 'id'|'ownerId'|'parentId'|'deletedAt'>) {
  if (item.deletedAt) throw inaccessible();
  const ids=[item.id]; let current=item.parentId;
  while(current) {
    if(ids.includes(current)||ids.length>=128)throw inaccessible();
    const parent=await db.fileEntry.findFirst({where:{id:current,ownerId:item.ownerId,isDirectory:true,deletedAt:null}});
    if(!parent)throw inaccessible();ids.push(parent.id);current=parent.parentId;
  }
  return ids;
}
export async function entryAccess(db: Db, id: string, actorId: string, write=false) {
  const item=await db.fileEntry.findFirst({where:{id,deletedAt:null,owner:{enabled:true}}});
  if(!item)throw inaccessible();
  const ancestors=await ancestorIds(db,item);
  if(item.ownerId===actorId)return {item,roots:ancestors,owned:true};
  const shares=await db.share.findMany({where:{recipientId:actorId,fileId:{in:ancestors},...(write?{permission:'READ_WRITE'}:{})},select:{fileId:true}});
  if(!shares.length)throw inaccessible();
  return {item,roots:shares.map(s=>s.fileId),owned:false};
}
export async function folderAccess(db: Db, parentId: string|null, actorId: string) {
  if(!parentId)return {ownerId:actorId,roots:[] as string[]};
  const access=await entryAccess(db,parentId,actorId,true);
  if(!access.item.isDirectory)throw inaccessible();
  return {ownerId:access.item.ownerId,roots:access.roots};
}
export function assertChildMutation(access: Awaited<ReturnType<typeof entryAccess>>) {
  // A recipient may edit a shared root file's contents, but not rename, move or
  // trash the shared root itself. Hierarchy operations remain inside its scope.
  if(!access.owned && access.roots.every(root=>root===access.item.id))throw inaccessible();
}
export async function assertMoveDestination(db: Db, parentId: string|null, actorId: string, source: Awaited<ReturnType<typeof entryAccess>>) {
  if(source.owned){const destination=await folderAccess(db,parentId,actorId);if(destination.ownerId!==source.item.ownerId)throw inaccessible();return}
  if(!parentId)throw inaccessible();
  const destination=await entryAccess(db,parentId,actorId,true);
  const ids=await ancestorIds(db,destination.item);
  if(!destination.item.isDirectory || destination.item.ownerId!==source.item.ownerId || !source.roots.some(root=>ids.includes(root)&&root!==source.item.id))throw inaccessible();
}
