import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';

const url=new URL(process.env.DATABASE_URL);
assert.match(url.pathname,/^\/voidnas_regression_test_[a-f0-9]+$/,'Refusing to test against a real database');
assert.equal(process.env.STORAGE_ROOT,'/tmp/voidnas-regression-storage','Refusing to use real storage');
const require=createRequire('/app/apps/api/package.json');
const argon2=require('argon2');
const {buildApp}=await import('/app/apps/api/dist/app.js');
const {hashToken,randomToken}=await import('/app/apps/api/dist/lib/security.js');
const {recoverTextEdits,stageTextEdit}=await import('/app/apps/api/dist/lib/text-files.js');
const {cleanupExpiredUploads}=await import('/app/apps/api/dist/lib/upload-cleanup.js');
const {authenticate}=await import('/app/apps/api/dist/lib/authentication.js');
const app=await buildApp();app.log.level='silent';await app.ready();
const password='Only-for-isolated-tests-2026';
const hash=await argon2.hash(password,{type:argon2.argon2id});
let passed=0;
const check=(label,fn)=>{fn();passed++;console.log(`PASS ${label}`)};
const request=(method,url,session,payload,headers={})=>app.inject({method,url,headers:{...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...headers},...(payload===undefined?{}:{payload})});
const status=(response,expected)=>assert.equal(response.statusCode,expected,`Expected ${expected}, got ${response.statusCode}: ${response.statusCode>=400?response.body:'response omitted'}`);
async function login(username,pw=password){
  const response=await request('POST','/api/auth/login',null,{username,password:pw});status(response,200);
  assert.equal('passwordHash' in response.json().user,false,'Login leaked password hash');
  return {cookie:response.headers['set-cookie'].split(';')[0],csrf:response.json().csrfToken};
}
async function upload(name,bytes,session,mimeType='application/octet-stream'){
  const created=await request('POST','/api/uploads',session,{fileName:name,size:bytes.length,mimeType});status(created,201);
  const id=created.json().id;
  for(let offset=0;offset<bytes.length;offset+=16*1024*1024){
    const chunk=bytes.subarray(offset,Math.min(bytes.length,offset+16*1024*1024));
    const patched=await request('PATCH',`/api/uploads/${id}`,session,chunk,{'content-type':'application/offset+octet-stream','upload-offset':String(offset),'content-length':String(chunk.length)});status(patched,204);
  }
  return id;
}
try{
  const setupResults=await Promise.all(['test-admin-one','test-admin-two'].map(username=>request('POST','/api/setup',null,{username,password})));
  check('first setup is serialized and permanently sealed',()=>assert.deepEqual(setupResults.map(r=>r.statusCode).sort(),[201,410]));
  assert.equal((await request('GET','/api/setup/status',null)).json().required,false);
  const owner=await app.prisma.user.create({data:{username:'test-owner',passwordHash:hash,quotaBytes:64n*1024n*1024n}});
  await app.prisma.user.create({data:{username:'test-other',passwordHash:hash,quotaBytes:1000n}});
  await app.prisma.user.create({data:{username:'test-blocked',passwordHash:hash,enabled:false}});
  const user=await login('test-owner'),other=await login('test-other');
  status(await request('POST','/api/auth/login',null,{username:'test-blocked',password}),401);
  check('disabled user login rejected',()=>{});
  const me=await request('GET','/api/auth/me',user);status(me,200);
  check('session token recoverable after reload/new tab',()=>assert.equal(me.json().csrfToken,user.csrf));
  check('login and me never disclose password hashes',()=>assert.equal('passwordHash' in me.json().user,false));
  const defaults={language:'en',timeZone:'Europe/Warsaw',theme:'dark'};
  const initialPreferences=await request('GET','/api/auth/preferences',user);status(initialPreferences,200);
  check('existing account has safe preference defaults',()=>assert.deepEqual(initialPreferences.json().preferences,defaults));
  const preferences={language:'pl',timeZone:'America/New_York',theme:'light'};
  const changed=await request('PATCH','/api/auth/preferences',user,preferences);status(changed,200);
  check('account preferences saved',()=>assert.deepEqual(changed.json().preferences,preferences));
  const untouched=await request('GET','/api/auth/preferences',other);status(untouched,200);
  check('preferences never affect another account',()=>assert.deepEqual(untouched.json().preferences,defaults));
  const newSession=await login('test-owner');
  const reloaded=await request('GET','/api/auth/me',newSession);status(reloaded,200);
  check('preferences survive a new login',()=>{for(const key of Object.keys(preferences))assert.equal(reloaded.json().user[key],preferences[key])});
  for(const invalid of [{language:'xx'},{theme:'neon'},{timeZone:'invalid-zone'},{role:'ADMIN',theme:'light'},{userId:owner.id,theme:'light'},{}])status(await request('PATCH','/api/auth/preferences',user,invalid),400);
  check('invalid preferences and identity/role injection rejected',()=>{});
  status(await request('PATCH','/api/auth/preferences',user,{theme:'dark'},{'x-csrf-token':''}),403);
  status(await request('GET','/api/auth/preferences',null),401);
  status(await request('PATCH','/api/auth/preferences',null,{theme:'dark'}),401);
  check('preference endpoints require session and CSRF',()=>{});
  status(await request('POST','/api/folders',user,{name:'rejected'},{'x-csrf-token':''}),403);
  status(await request('POST','/api/folders',user,{name:'rejected'},{'x-csrf-token':other.csrf}),403);
  check('missing and other-session CSRF token rejected',()=>{});
  status(await request('GET','/api/admin/system',user),403);
  check('admin system inaccessible to normal user',()=>{});
  const legacyToken=randomToken();
  await app.prisma.session.create({data:{userId:owner.id,tokenHash:hashToken(legacyToken),csrfHash:'old-token-no-longer-available',expiresAt:new Date(Date.now()+3600000)}});
  const legacy={cookie:`voidnas_session=${legacyToken}`,csrf:''};
  const legacyMe=await request('GET','/api/auth/me',legacy);status(legacyMe,200);legacy.csrf=legacyMe.json().csrfToken;
  status(await request('POST','/api/folders',legacy,{name:'after-browser-reopen'}),200);
  check('existing legacy session can mutate after recovering CSRF',()=>{});

  const binary=Buffer.alloc(16*1024*1024+1024,0x4d);binary[1]=0x5a;binary[2]=0;
  const exe=await upload('Antigravity-x64.exe',binary,user);
  const download=await request('GET',`/api/files/${exe}/download`,user);status(download,200);
  check('EXE upload in 16 MB chunks and exact download',()=>assert.deepEqual(download.rawPayload,binary));
  const range=await request('GET',`/api/files/${exe}/download`,user,undefined,{range:'bytes=0-2'});status(range,206);
  check('download Range response',()=>assert.deepEqual(range.rawPayload,binary.subarray(0,3)));
  status(await request('GET',`/api/files/${exe}/text`,user),413);
  const smallBinary=await upload('binary-disguised.txt',Buffer.from([77,90,0,1]),user,'text/plain');
  status(await request('GET',`/api/files/${smallBinary}/text`,user),415);
  check('binary files cannot be edited as text',()=>{});
  status(await request('GET',`/api/files/${exe}/download`,other),404);
  check('foreign file download rejected',()=>{});

  const original='\ufeffZażółć gęślą jaźń\r\n';
  const textId=await upload('document.txt',Buffer.from(original),user,'text/plain');
  const opened=await request('GET',`/api/files/${textId}/text`,user);status(opened,200);
  const initialVersion=opened.json().version;
  check('text opening preserves BOM and CRLF',()=>assert.equal(opened.json().content,original));
  status(await request('GET',`/api/files/${textId}/text`,other),404);
  status(await request('PUT',`/api/files/${textId}/text`,other,{content:'attack',version:initialVersion}),404);
  check('text editor enforces ownership for read and write',()=>{});
  const updated='Nowa treść pliku\r\n';
  const saved=await request('PUT',`/api/files/${textId}/text`,user,{content:updated,version:initialVersion});status(saved,200);
  status(await request('PUT',`/api/files/${textId}/text`,user,{content:'stale',version:initialVersion}),409);
  check('stale text version cannot overwrite newer changes',()=>{});
  const downloadedText=await request('GET',`/api/files/${textId}/download`,user);status(downloadedText,200);
  check('saved text downloadable and quota accounting updated',()=>{
    assert.equal(downloadedText.body,updated);
  });
  const used=await app.prisma.user.findUniqueOrThrow({where:{id:owner.id}});
  assert.equal(used.usedBytes,BigInt(binary.length+4+Buffer.byteLength(updated)));
  await app.prisma.user.update({where:{id:owner.id},data:{quotaBytes:used.usedBytes}});
  status(await request('PUT',`/api/files/${textId}/text`,user,{content:updated+'larger',version:saved.json().version}),413);
  check('text edits cannot bypass quota',()=>{});
  status(await request('POST',`/api/files/${textId}/copy`,user),413);
  check('copy quota checked before writing physical data',()=>{});
  await app.prisma.user.update({where:{id:owner.id},data:{quotaBytes:64n*1024n*1024n}});
  const copied=await request('POST',`/api/files/${textId}/copy`,user);status(copied,200);
  const copiedId=copied.json().item.id;
  const copiedDownload=await request('GET',`/api/files/${copiedId}/download`,user);status(copiedDownload,200);
  check('descriptor-anchored copy preserves content',()=>assert.equal(copiedDownload.body,updated));
  status(await request('DELETE',`/api/files/${copiedId}`,user),200);
  status(await request('DELETE',`/api/trash/${copiedId}`,user),200);

  // Exercise a real streaming HTTP request, holding its body open while other
  // requests try to append or cancel. No production port or data is used.
  const address=await app.listen({host:'127.0.0.1',port:0});
  const hold=await request('POST','/api/uploads',user,{fileName:'concurrency.bin',size:256*1024});status(hold,201);
  const holdId=hold.json().id,first=Buffer.alloc(128*1024,65),last=Buffer.alloc(128*1024,66);
  let resolveTransfer,rejectTransfer;
  const transfer=new Promise((resolve,reject)=>{resolveTransfer=resolve;rejectTransfer=reject});
  const writer=httpRequest(`${address}/api/uploads/${holdId}`,{method:'PATCH',headers:{cookie:user.cookie,'x-csrf-token':user.csrf,'content-type':'application/offset+octet-stream','upload-offset':'0','content-length':String(first.length)}},response=>{response.resume();response.on('end',()=>resolveTransfer(response.statusCode))});
  writer.on('error',rejectTransfer);writer.write(first.subarray(0,65536));
  for(let attempt=0;attempt<100;attempt++){if((await app.prisma.uploadSession.findUniqueOrThrow({where:{id:holdId}})).writing)break;await new Promise(resolve=>setTimeout(resolve,20))}
  const busy=await app.prisma.uploadSession.findUniqueOrThrow({where:{id:holdId}});
  assert.equal(busy.writing,true);assert.equal(busy.receivedBytes,0n);
  status(await request('PATCH',`/api/uploads/${holdId}`,user,last,{'content-type':'application/offset+octet-stream','upload-offset':String(first.length),'content-length':String(last.length)}),409);
  status(await request('DELETE',`/api/uploads/${holdId}`,user),409);
  writer.end(first.subarray(65536));assert.equal(await transfer,204);
  status(await request('PATCH',`/api/uploads/${holdId}`,user,last,{'content-type':'application/offset+octet-stream','upload-offset':String(first.length),'content-length':String(last.length)}),204);
  const raceDownload=await request('GET',`/api/files/${holdId}/download`,user);status(raceDownload,200);
  check('in-flight chunks cannot be overwritten or cancelled',()=>assert.deepEqual(raceDownload.rawPayload,Buffer.concat([first,last])));
  status(await request('DELETE',`/api/files/${holdId}`,user),200);status(await request('DELETE',`/api/trash/${holdId}`,user),200);

  const aborted=await request('POST','/api/uploads',user,{fileName:'interrupted.bin',size:first.length});status(aborted,201);
  const abortedId=aborted.json().id;
  const interrupted=httpRequest(`${address}/api/uploads/${abortedId}`,{method:'PATCH',headers:{cookie:user.cookie,'x-csrf-token':user.csrf,'content-type':'application/offset+octet-stream','upload-offset':'0','content-length':String(first.length)}});interrupted.on('error',()=>undefined);interrupted.write(first.subarray(0,65536));
  for(let attempt=0;attempt<100;attempt++){if((await app.prisma.uploadSession.findUniqueOrThrow({where:{id:abortedId}})).writing)break;await new Promise(resolve=>setTimeout(resolve,20))}
  interrupted.destroy();
  for(let attempt=0;attempt<100;attempt++){if(!(await app.prisma.uploadSession.findUniqueOrThrow({where:{id:abortedId}})).writing)break;await new Promise(resolve=>setTimeout(resolve,20))}
  const resume=await request('HEAD',`/api/uploads/${abortedId}`,user);status(resume,204);assert.equal(resume.headers['upload-offset'],'0');
  status(await request('PATCH',`/api/uploads/${abortedId}`,user,first,{'content-type':'application/offset+octet-stream','upload-offset':'0','content-length':String(first.length)}),204);
  const resumedDownload=await request('GET',`/api/files/${abortedId}/download`,user);status(resumedDownload,200);
  check('interrupted streamed upload can resume without corrupting contents',()=>assert.deepEqual(resumedDownload.rawPayload,first));
  status(await request('DELETE',`/api/files/${abortedId}`,user),200);status(await request('DELETE',`/api/trash/${abortedId}`,user),200);

  status(await request('DELETE',`/api/files/${smallBinary}`,user),200);
  status(await request('POST',`/api/trash/${smallBinary}/restore`,user),200);
  check('trash restore works with recovered CSRF',()=>{});
  status(await request('DELETE',`/api/files/${smallBinary}`,user),200);
  status(await request('DELETE',`/api/trash/${smallBinary}`,user),200);
  const afterPurge=await app.prisma.user.findUniqueOrThrow({where:{id:owner.id}});
  check('permanent deletion releases space',()=>assert.equal(afterPurge.usedBytes,used.usedBytes-4n));

  const reserved=await Promise.all([request('POST','/api/uploads',other,{fileName:'one.bin',size:800}),request('POST','/api/uploads',other,{fileName:'two.bin',size:800})]);
  check('parallel quota reservations cannot exceed limit',()=>assert.deepEqual(reserved.map(r=>r.statusCode).sort(),[201,413]));
  const firstReservation=reserved.find(r=>r.statusCode===201).json().id;
  status(await request('DELETE',`/api/uploads/${firstReservation}`,other),200);
  check('cancelled upload releases reservation',()=>{});
  const otherText=await upload('quota.txt',Buffer.alloc(100,65),other,'text/plain');
  const held=await request('POST','/api/uploads',other,{fileName:'held.bin',size:800});status(held,201);
  const otherOpened=await request('GET',`/api/files/${otherText}/text`,other);status(otherOpened,200);
  status(await request('PUT',`/api/files/${otherText}/text`,other,{content:'B'.repeat(300),version:otherOpened.json().version}),413);
  status(await request('DELETE',`/api/uploads/${held.json().id}`,other),200);
  status(await request('PUT',`/api/files/${otherText}/text`,other,{content:'B'.repeat(300),version:otherOpened.json().version}),200);
  check('text editing accounts for upload reservations',()=>{});

  // Simulate restart between filesystem stage and DB COMMIT in both outcomes.
  const before=await app.prisma.fileEntry.findUniqueOrThrow({where:{id:textId}});
  const abandoned=await stageTextEdit(owner.id,before.storagePath,Buffer.from('uncommitted'));
  await recoverTextEdits(async storagePath=>!!await app.prisma.fileEntry.findUnique({where:{storagePath},select:{id:true}}));
  check('uncommitted text edit recovery retains original',()=>{});
  assert.equal((await readFile(`${process.env.STORAGE_ROOT}/${before.storagePath}`)).toString(),updated);
  await assert.rejects(readFile(`${process.env.STORAGE_ROOT}/${abandoned.storagePath}`));
  const committed=await stageTextEdit(owner.id,before.storagePath,Buffer.from('committed'));
  await app.prisma.fileEntry.update({where:{id:textId},data:{storagePath:committed.storagePath,size:9n}});
  await recoverTextEdits(async storagePath=>!!await app.prisma.fileEntry.findUnique({where:{storagePath},select:{id:true}}));
  check('committed text edit recovery retains new content',()=>{});
  assert.equal((await readFile(`${process.env.STORAGE_ROOT}/${committed.storagePath}`)).toString(),'committed');
  await assert.rejects(readFile(`${process.env.STORAGE_ROOT}/${before.storagePath}`));

  const secondDevice=await login('test-owner');
  status(await request('PATCH','/api/auth/password',user,{currentPassword:'wrong',newPassword:'Replacement-test-password-2026'}),400);
  status(await request('PATCH','/api/auth/password',user,{currentPassword:password,newPassword:'Replacement-test-password-2026'}),200);
  status(await request('GET','/api/auth/me',secondDevice),401);
  check('password changes work and revoke other-device sessions',()=>{});
  await login('test-owner','Replacement-test-password-2026');
  status(await request('POST','/api/auth/logout',user),200);
  status(await request('GET','/api/auth/me',user),401);
  check('logout revokes session',()=>{});
  const adminAccount=await app.prisma.user.findFirstOrThrow({where:{role:'ADMIN'}});
  const adminLogin=await app.inject({method:'POST',url:'/api/auth/login',remoteAddress:'198.51.100.10',payload:{username:adminAccount.username,password}});status(adminLogin,200);
  const admin={cookie:adminLogin.headers['set-cookie'].split(';')[0],csrf:adminLogin.json().csrfToken};
  const createdUser=await request('POST','/api/admin/users',admin,{username:'test-managed',password,role:'USER',quotaBytes:'1000'});status(createdUser,200);
  const managedId=createdUser.json().user.id;
  assert.equal('passwordHash' in createdUser.json().user,false);
  const managedLogin=await app.inject({method:'POST',url:'/api/auth/login',remoteAddress:'198.51.100.11',payload:{username:'test-managed',password}});status(managedLogin,200);
  const managed={cookie:managedLogin.headers['set-cookie'].split(';')[0],csrf:managedLogin.json().csrfToken};
  for(const endpoint of ['overview','users','system','storage','audit'])status(await request('GET','/api/admin/'+endpoint,managed),403);
  status(await request('POST','/api/admin/users',managed,{username:'escalated',password,role:'ADMIN',quotaBytes:null}),403);
  status(await request('PATCH','/api/admin/users/'+adminAccount.id,managed,{role:'ADMIN'}),403);
  check('every admin API blocks normal users and privilege escalation',()=>{});
  status(await request('PATCH','/api/admin/users/'+managedId,admin,{role:'ADMIN'}),200);
  status(await request('GET','/api/auth/me',managed),401);
  status(await request('PATCH','/api/admin/users/'+managedId,admin,{role:'USER',quotaBytes:'2000',enabled:false}),200);
  const blockedLogin=await app.inject({method:'POST',url:'/api/auth/login',remoteAddress:'198.51.100.12',payload:{username:'test-managed',password}});status(blockedLogin,401);
  status(await request('PATCH','/api/admin/users/'+managedId,admin,{enabled:true,password:'Reset-managed-password-2026'}),200);
  check('admin creates, changes role/quota, disables and resets passwords; sessions revoked',()=>{});
  status(await request('PATCH','/api/admin/users/'+adminAccount.id,admin,{role:'USER'}),409);
  status(await request('DELETE','/api/admin/users/'+adminAccount.id,admin),409);
  check('administrator cannot remove own access',()=>{});

  for(const endpoint of ['/api/auth/login','/api/setup']){
    const response=await app.inject({method:'POST',url:endpoint,remoteAddress:'198.51.100.30',headers:{host:'nas.example.com',origin:'https://evil.example','sec-fetch-site':'cross-site'},payload:{username:'irrelevant',password}});status(response,403);
  }
  status(await request('POST','/api/folders',other,{name:'origin-test'},{host:'nas.example.com',origin:'https://evil.example'}),403);
  check('cross-site login, setup and authenticated mutations rejected',()=>{});

  const throttled=await app.prisma.user.create({data:{username:'test-throttle',passwordHash:hash}});
  for(let i=0;i<8;i++)assert.equal(await authenticate(app.prisma,'test-throttle','incorrect'),null);
  assert.equal(await authenticate(app.prisma,'test-throttle',password),null);
  await app.prisma.systemSetting.update({where:{key:`login-throttle:${throttled.id}`},data:{value:{start:Date.now()-16*60_000,failures:8}}});
  assert.equal((await authenticate(app.prisma,'test-throttle',password)).id,throttled.id);
  check('persistent account throttle blocks IP rotation and releases after 15 minutes',()=>{});
  for(let i=0;i<9;i++){
    const response=await app.inject({method:'POST',url:'/api/auth/login',remoteAddress:'198.51.100.31',payload:{username:'nonexistent',password:'incorrect'}});
    status(response,i===8?429:401);
  }
  check('login IP rate limit is enforced',()=>{});

  const stale=await request('POST','/api/uploads',other,{fileName:'expired.bin',size:600});status(stale,201);
  const staleId=stale.json().id,expiredDate=new Date(Date.now()-1000);
  await app.prisma.uploadSession.update({where:{id:staleId},data:{expiresAt:expiredDate,writing:true}});
  await app.prisma.storageReservation.update({where:{uploadSessionId:staleId},data:{expiresAt:expiredDate}});
  status(await request('POST','/api/uploads',other,{fileName:'over-limit.bin',size:600}),413);
  const currentOther=await app.prisma.user.findUniqueOrThrow({where:{id:(await app.prisma.user.findUniqueOrThrow({where:{username:'test-other'}})).id}});
  status(await request('PATCH','/api/admin/users/'+currentOther.id,admin,{quotaBytes:'500'}),409);
  await cleanupExpiredUploads(app.prisma,process.env.STORAGE_ROOT);
  assert.ok(await app.prisma.storageReservation.findUnique({where:{uploadSessionId:staleId}}));
  await app.prisma.uploadSession.update({where:{id:staleId},data:{writing:false}});
  await cleanupExpiredUploads(app.prisma,process.env.STORAGE_ROOT);
  assert.equal(await app.prisma.storageReservation.findUnique({where:{uploadSessionId:staleId}}),null);
  check('expired writers keep quota; cleanup releases it only after safe cancellation',()=>{});

  const left=await request('POST','/api/folders',other,{name:'left'}),right=await request('POST','/api/folders',other,{name:'right'});status(left,200);status(right,200);
  const leftId=left.json().item.id,rightId=right.json().item.id;
  const moves=await Promise.all([request('PATCH',`/api/files/${leftId}`,other,{parentId:rightId}),request('PATCH',`/api/files/${rightId}`,other,{parentId:leftId})]);
  check('concurrent reciprocal folder moves cannot create cycles',()=>assert.deepEqual(moves.map(r=>r.statusCode).sort(),[200,409]));
  status(await request('PATCH',`/api/files/${textId}`,other,{name:'stolen'}),404);
  status(await request('PATCH',`/api/files/${otherText}`,other,{storagePath:'/etc/passwd',ownerId:owner.id}),400);
  for(const name of ['../escape','CON.txt','header\r\ninjection','bad\u202ename'])status(await request('POST','/api/folders',other,{name}),400);
  check('IDOR, path/name injection and physical-path overrides rejected',()=>{});
  const list=await request('GET','/api/files',other);status(list,200);
  assert.equal(JSON.stringify(list.json()).includes('storagePath'),false);
  check('public file metadata never exposes physical paths',()=>{});

  const sharedFolder=await request('POST','/api/folders',other,{name:'shared-folder'});status(sharedFolder,200);
  const sharedFolderId=sharedFolder.json().item.id;
  const sharedFile=await upload('shared.txt',Buffer.from('shared'),other,'text/html');
  status(await request('PATCH',`/api/files/${sharedFile}`,other,{parentId:sharedFolderId}),200);
  const shareResult=await request('POST','/api/shares',other,{fileId:sharedFolderId,username:adminAccount.username,permission:'READ'});status(shareResult,200);
  const shareId=shareResult.json().share.id;
  status(await request('GET',`/api/shares/${shareId}/files`,admin),200);
  const sharedDownload=await request('GET',`/api/files/${sharedFile}/download`,admin);status(sharedDownload,200);
  assert.match(sharedDownload.headers['content-type'],/^text\/plain/);
  assert.match(sharedDownload.headers['content-disposition'],/^attachment/);
  status(await request('PATCH',`/api/files/${sharedFile}`,admin,{name:'unauthorized-edit'}),404);
  status(await request('DELETE',`/api/files/${sharedFolderId}`,other),200);
  status(await request('GET',`/api/files/${sharedFile}/download`,admin),404);
  status(await request('POST',`/api/trash/${sharedFolderId}/restore`,other),200);
  status(await request('GET',`/api/files/${sharedFile}/download`,admin),200);
  status(await request('DELETE',`/api/shares/${shareId}`,other),200);
  status(await request('GET',`/api/files/${sharedFile}/download`,admin),404);
  check('folder shares enforce READ, trash visibility and immediate revocation; MIME claims ignored',()=>{});
  const logs=await request('GET','/api/admin/audit',admin);status(logs,200);
  assert.equal(JSON.stringify(logs.json()).includes(password),false);
  check('audit logs do not expose credentials',()=>{});
  const {runFeatures}=await import('/app/feature-regression.mjs');
  for(const label of await runFeatures(app,admin,password))check(label,()=>{});
  const {runDurableUploads}=await import('/app/durable-upload-regression.mjs');
  for(const label of await runDurableUploads(app,admin,password))check(label,()=>{});
  console.log(`ALL ${passed} REGRESSION CHECKS PASSED`);
}finally{await app.close()}
