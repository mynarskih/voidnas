import { describe, expect, it } from 'vitest';
import { preferencesSchema } from '../src/lib/preferences.js';
describe('preferences validation',()=>{
  it('accepts supported languages, themes and real time zones',()=>{
    expect(preferencesSchema.parse({language:'pl',theme:'light',timeZone:'Europe/Warsaw'})).toEqual({language:'pl',theme:'light',timeZone:'Europe/Warsaw'});
    expect(preferencesSchema.parse({timeZone:'UTC'})).toEqual({timeZone:'UTC'});
  });
  it('rejects unknown fields, invalid choices, invalid zones and empty changes',()=>{
    for(const data of [{},{language:'xx'},{theme:'neon'},{timeZone:'not-a-zone'},{timeZone:''},{timeZone:'x'.repeat(101)},{userId:'other',theme:'light'},{role:'ADMIN',language:'pl'},{quotaBytes:'999999'}])expect(preferencesSchema.safeParse(data).success).toBe(false);
  });
});
