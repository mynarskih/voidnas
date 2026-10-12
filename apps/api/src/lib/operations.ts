import { constants } from 'node:fs';
import { statfs } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { hostMetrics } from './metrics.js';
import { openStorageFile } from './storage-boundary.js';
import { readAdminSettings } from './admin-settings.js';
import { cleanupTrash } from './purge.js';

export type BackupStatus={status:'success'|'failed';lastAttemptAt:string;lastSuccessAt:string|null};
export async function readBackupStatus():Promise<BackupStatus|null>{
  let handle;
  try{handle=await openStorageFile(config.STORAGE_ROOT,'.operations/backup-status.json',constants.O_RDONLY);const info=await handle.stat();if(info.size>4096)throw new Error('Invalid backup status');
    const value=JSON.parse(await handle.readFile({encoding:'utf8'}));
    if(!['success','failed'].includes(value.status)||typeof value.lastAttemptAt!=='string'||!Number.isFinite(Date.parse(value.lastAttemptAt))||(value.lastSuccessAt!==null&&!Number.isFinite(Date.parse(value.lastSuccessAt))))throw new Error('Invalid backup status');
    return {status:value.status,lastAttemptAt:value.lastAttemptAt,lastSuccessAt:value.lastSuccessAt};
  }catch{return null}finally{await handle?.close()}
}
export async function setAlert(db:PrismaClient,code:string,active:boolean,message:string,severity='Warning'){
  const previous=await db.adminAlert.findUnique({where:{key:code}});
  if(!active){if(previous?.active)await db.adminAlert.update({where:{key:code},data:{active:false,resolvedAt:new Date()}});return}
  await db.adminAlert.upsert({where:{key:code},create:{key:code,code,message,severity},update:{active:true,message,severity,lastSeenAt:new Date(),...(previous&&!previous.active?{resolvedAt:null,acknowledgedAt:null,firstSeenAt:new Date()}:{})}});
}
let checking=false;
let databaseOutage:Date|null=null;
export async function checkOperations(db:PrismaClient){
  if(checking)return false;checking=true;
  try{
    const database=await db.$queryRaw`SELECT 1`.then(()=>true).catch(()=>false);
    if(!database){databaseOutage??=new Date();return false}
    // Authentication/storage depend on PostgreSQL. While it is down, the UI
    // reports a connection error; record the observed outage after recovery.
    if(databaseOutage){
      await setAlert(db,'DATABASE_UNAVAILABLE',true,'A database outage was detected','Critical');
      await db.adminAlert.update({where:{key:'DATABASE_UNAVAILABLE'},data:{firstSeenAt:databaseOutage}});
      await setAlert(db,'DATABASE_UNAVAILABLE',false,'Database is available');databaseOutage=null;
    }
    const settings=await readAdminSettings(db);
    const [host,backup,storage,failures]=await Promise.all([hostMetrics(),readBackupStatus(),statfs(config.STORAGE_ROOT).catch(()=>null),db.auditLog.count({where:{action:'LOGIN_FAILED',createdAt:{gt:new Date(Date.now()-15*60_000)}}})]);
    const hostUsage=(host.storage as {usagePercent?:number}|null)?.usagePercent;
    const usage=typeof hostUsage==='number'&&Number.isFinite(hostUsage)?hostUsage:storage&&storage.blocks?100*(1-storage.bavail/storage.blocks):null;
    await setAlert(db,'STORAGE_UNAVAILABLE',!storage,'Storage is unavailable','Critical');
    await setAlert(db,'STORAGE_LOW',usage!==null&&usage>=settings.storageWarningPercent,'Storage is running low');
    await setAlert(db,'SYSTEM_MONITOR_UNAVAILABLE',host.status==='Unavailable','System monitor is unavailable');
    await setAlert(db,'BACKUP_FAILED',backup?.status==='failed','The last backup attempt failed','Critical');
    await setAlert(db,'BACKUP_MISSING',!backup?.lastSuccessAt,'No successful backup has been recorded');
    await setAlert(db,'BACKUP_STALE',!!backup?.lastSuccessAt&&Date.now()-Date.parse(backup.lastSuccessAt)>settings.backupMaxAgeHours*3600_000,'The last successful backup is overdue');
    await setAlert(db,'LOGIN_ACTIVITY',failures>=8,'Repeated failed logins were detected');
    return true;
  }finally{checking=false}
}
export async function maintainOperations(db:PrismaClient){
  if(!await checkOperations(db))return;
  const settings=await readAdminSettings(db);
  await cleanupTrash(db,config.STORAGE_ROOT,settings.trashRetentionDays);
  await db.publicLinkGrant.deleteMany({where:{expiresAt:{lt:new Date()}}});
}
