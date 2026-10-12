import { z } from 'zod';
import type { Db } from './authorization.js';

export const settingsSchema=z.object({
  trashRetentionDays:z.union([z.literal(7),z.literal(30),z.literal(90),z.null()]),
  uploadBytesPerSecond:z.number().int().min(0).max(1024**3).refine(value=>value===0||value>=65536,'Use at least 64 KB/s or Unlimited'),
  downloadBytesPerSecond:z.number().int().min(0).max(1024**3).refine(value=>value===0||value>=65536,'Use at least 64 KB/s or Unlimited'),
  maxConcurrentTransfers:z.number().int().min(1).max(16),
  storageWarningPercent:z.number().int().min(50).max(99),
  backupMaxAgeHours:z.number().int().min(1).max(720),
  publicLinksEnabled:z.boolean()
}).strict();
export type AdminSettings=z.infer<typeof settingsSchema>;
export const defaultSettings:AdminSettings={trashRetentionDays:null,uploadBytesPerSecond:0,downloadBytesPerSecond:0,maxConcurrentTransfers:4,storageWarningPercent:90,backupMaxAgeHours:48,publicLinksEnabled:true};
export async function readAdminSettings(db:Db):Promise<AdminSettings>{
  const row=await db.systemSetting.findUnique({where:{key:'admin-settings'}});
  return row?settingsSchema.parse({...defaultSettings,...row.value as object}):{...defaultSettings};
}
