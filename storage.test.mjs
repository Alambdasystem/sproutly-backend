import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from './server.mjs';
import {createVerifiedBackup,restoreBackup,verifyBackup,startBackupSchedule} from './backup.mjs';
import {requireMountedStorage} from './storage.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1EAAAAASUVORK5CYII=';
const start=async dbPath=>{const server=createApp({dbPath,backupEnabled:false,requiredMount:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));return{server,base:`http://127.0.0.1:${server.address().port}/api/v1`}};
const close=server=>new Promise(r=>server.close(r));
async function request(base,path,{token,body,method=body?'POST':'GET'}={}){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}}
test('accounts, private photos, journal and sessions survive restart and a verified backup restore',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sproutly-restore-'));let app;
 try{
  const path=join(directory,'source.sqlite');app=await start(path);
  const account=await request(app.base,'/auth/register',{body:{name:'Recovery test',email:'recovery@example.com',password:'recover-photo-123'}}),token=account.data.token;
  const plant=await request(app.base,'/plants',{token,body:{name:'Recovery basil',species:'Ocimum basilicum',stage:'Seedling'}});
  const photo=await request(app.base,'/media',{token,body:{data:image}});
  await request(app.base,'/journal',{token,body:{plantId:plant.data.id,type:'Note',note:'A private recovery test.',mediaId:photo.data.id}});
  await close(app.server);app=await start(path);
  assert.equal((await request(app.base,'/bootstrap',{token})).data.plants[0].name,'Recovery basil');assert.equal((await request(app.base,'/media/'+photo.data.id,{token})).data.data,image);
  const db=new DatabaseSync(path);let snapshot;try{snapshot=await createVerifiedBackup(db,join(directory,'backups'))}finally{db.close()}
  assert.equal(snapshot.counts.photos,1);assert.ok(snapshot.restoreVerifiedAt);
  const target=join(directory,'restored.sqlite');await restoreBackup(snapshot.path,target);await close(app.server);app=await start(target);
  const login=await request(app.base,'/auth/login',{body:{email:'recovery@example.com',password:'recover-photo-123'}});assert.equal(login.status,200);
  const state=await request(app.base,'/bootstrap',{token:login.data.token});assert.ok(state.data.journal.some(j=>j.note==='A private recovery test.'));assert.equal((await request(app.base,'/media/'+photo.data.id,{token:login.data.token})).data.data,image);
  const other=await request(app.base,'/auth/demo',{body:{}});assert.equal((await request(app.base,'/media/'+photo.data.id,{token:other.data.token})).status,404);
  await assert.rejects(restoreBackup(snapshot.path,target),/already exists/);
  const bytes=await readFile(snapshot.path);bytes[100]^=1;await writeFile(snapshot.path,bytes);await assert.rejects(verifyBackup(snapshot.path),/checksum/);
 }finally{if(app)await close(app.server);await rm(directory,{recursive:true,force:true})}
});
test('persistent storage guard rejects unmounted, outside and symlinked paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sproutly-mount-'));
 try{
  const info=`1 0 0:1 / ${root} rw - ext4 disk rw`,dbPath=join(root,'data.sqlite');
  assert.throws(()=>requireMountedStorage({dbPath,mountPath:root,mountInfo:''}),/not mounted/);
  assert.throws(()=>requireMountedStorage({dbPath:'/tmp/outside.sqlite',mountPath:root,mountInfo:info}),/under the persistent/);
  assert.equal(requireMountedStorage({dbPath,mountPath:root,backupDir:join(root,'backups'),mountInfo:info}).persistent,true);
  await symlink('/tmp/elsewhere.sqlite',dbPath);assert.throws(()=>requireMountedStorage({dbPath,mountPath:root,mountInfo:info}),/symlinks/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('scheduled backups verify restore and retain only the configured snapshots',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sproutly-schedule-'));const app=await start(join(root,'app.sqlite'));const db=new DatabaseSync(join(root,'app.sqlite'));let scheduler;
 try{
  for(let i=0;i<3;i++)await createVerifiedBackup(db,join(root,'backups'),{keep:2});
  const {readdir}=await import('node:fs/promises');assert.equal((await readdir(join(root,'backups'))).filter(n=>n.endsWith('.sqlite')).length,2);
  scheduler=startBackupSchedule(db,{directory:join(root,'backups'),onEvent:()=>{}});await scheduler.run();assert.ok(scheduler.status.lastSuccessAt);assert.ok(scheduler.status.restoreVerifiedAt);assert.equal(scheduler.status.lastFailureAt,null);
 }finally{if(scheduler)await scheduler.stop();db.close();await close(app.server);await rm(root,{recursive:true,force:true})}
});
