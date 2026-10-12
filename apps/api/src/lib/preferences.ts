import { z } from 'zod';

export function validTimeZone(value:string){
  try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true}catch{return false}
}
export const preferencesSchema=z.object({
  language:z.enum(['en','pl']).optional(),
  timeZone:z.string().min(1).max(100).refine(validTimeZone,'Invalid IANA time zone').optional(),
  theme:z.enum(['dark','light']).optional()
}).strict().refine(value=>Object.keys(value).length>0,'No preferences provided');
export const preferenceSelection={language:true,timeZone:true,theme:true} as const;
