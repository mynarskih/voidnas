import { expect, it } from 'vitest';
import { publicUser } from '../src/lib/public-user.js';
it('never exposes password hashes, tokens or new private fields',()=>{
  expect(publicUser({id:'user',username:'name',role:'USER',quotaBytes:10n,passwordHash:'private',tokenHash:'private',csrfHash:'private',futureSecret:'private'})).toEqual({id:'user',username:'name',role:'USER',quotaBytes:'10'});
});
