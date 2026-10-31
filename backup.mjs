import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {mkdir,chmod,rename,writeFile,readFile,readdir,unlink,copyFile,access,statfs} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const pattern=/^sproutly-\d{8}T\d{9}Z-[a-f0-9-]+\.sqlite$/;
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
export function inspectDatabase(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const integrity=db.prepare('PRAGMA quick_check').all();if(integrity.some(row=>Object.values(row)[0]!=='ok'))throw new Error('SQLite integrity check failed.');
  const counts={};for(const table of ['users','sessions','records','requests'])counts[table]=db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  counts.photos=db.prepare("SELECT count(*) AS n FROM records WHERE kind='media'").get().n;
  return counts;
 }finally{db.close()}
}
export async function verifyBackup(path){
 const manifest=JSON.parse(await readFile(path+'.json','utf8'));
 if(manifest.version!==1||manifest.file!==basename(path)||!pattern.test(manifest.file))throw new Error('Invalid backup manifest.');
 if(await digest(path)!==manifest.sha256)throw new Error('Backup checksum mismatch.');
 const counts=inspectDatabase(path);if(JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw new Error('Backup record counts do not match.');
 return manifest;
}
export async function createVerifiedBackup(db,directory,{keep=7}={}){
 if(!Number.isInteger(keep)||keep<1||keep>30)throw new Error('Backup retention must be 1–30 snapshots.');
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 const space=await statfs(directory),estimated=db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size;
 if(space.bavail*space.bsize<estimated*2+32*1024*1024)throw new Error('Insufficient disk headroom for a backup and restore probe; existing snapshots are retained.');
 const createdAt=new Date().toISOString(),file=`sproutly-${createdAt.replace(/[-:.]/g,'')}-${randomUUID()}.sqlite`,path=join(directory,file),temporary=path+'.partial';
 try{
  await backup(db,temporary);await chmod(temporary,0o600);
  const counts=inspectDatabase(temporary),sha256=await digest(temporary);
  await rename(temporary,path);
  await writeFile(path+'.json',JSON.stringify({version:1,file,createdAt,sha256,counts},null,2),{flag:'wx',mode:0o600});
  const manifest=await verifyBackup(path);
  // Reopen and verify an independent copy, never the running database.
  const probe=path+'.restore-check';
  try{await copyFile(path,probe,constants.COPYFILE_EXCL);await chmod(probe,0o600);if(await digest(probe)!==sha256)throw new Error('Restore probe checksum differs.');if(JSON.stringify(inspectDatabase(probe))!==JSON.stringify(counts))throw new Error('Restore probe differs from backup.')}finally{await unlink(probe).catch(()=>{})}
  const snapshots=(await readdir(directory)).filter(n=>pattern.test(n)).sort().reverse();
  for(const old of snapshots.slice(keep)){await unlink(join(directory,old));await unlink(join(directory,old)+'.json').catch(()=>{})}
  return{...manifest,path,restoreVerifiedAt:new Date().toISOString()};
 }catch(error){await unlink(temporary).catch(()=>{});throw error}
}
export async function restoreBackup(snapshot,destination){
 const manifest=await verifyBackup(snapshot),target=resolve(destination);
 for(const path of [target,target+'-wal',target+'-shm']){try{await access(path)}catch(e){if(e.code==='ENOENT')continue;throw e}throw new Error('Restore destination already exists; choose a new empty path.');}
 await mkdir(dirname(target),{recursive:true,mode:0o700});await copyFile(snapshot,target,constants.COPYFILE_EXCL);await chmod(target,0o600);
 try{const counts=inspectDatabase(target);if(JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw new Error('Restored database differs from backup.');return{destination:target,counts,verifiedAt:new Date().toISOString()}}catch(e){await unlink(target).catch(()=>{});throw e}
}
export function startBackupSchedule(db,{directory,intervalHours=24,keep=7,onEvent=console.log,onVerified=null}={}){
 if(!Number.isInteger(keep)||keep<1||keep>30)throw new Error('Backup retention must be 1–30 snapshots.');
 if(!Number.isFinite(intervalHours)||intervalHours<1||intervalHours>168)throw new Error('Backup interval must be 1–168 hours.');
 const status={enabled:true,lastSuccessAt:null,restoreVerifiedAt:null,lastFailureAt:null};let pending=null,stopped=false;
 const run=()=>{
  if(stopped||pending)return pending;
  if(status.lastSuccessAt&&Date.now()-Date.parse(status.lastSuccessAt)<intervalHours*3600000)return Promise.resolve();
  pending=createVerifiedBackup(db,directory,{keep}).then(async result=>{status.lastSuccessAt=result.createdAt;status.restoreVerifiedAt=result.restoreVerifiedAt;status.lastFailureAt=null;onEvent('backup_verified',{createdAt:result.createdAt,counts:result.counts});if(onVerified)try{await onVerified(result)}catch{console.error('offsite_backup_failed')}}).catch(error=>{status.lastFailureAt=new Date().toISOString();console.error('backup_failed',error.message)}).finally(()=>{pending=null});return pending;
 };
 const timer=setInterval(run,60000);timer.unref();void run();
 return{status,run,stop:()=>{stopped=true;clearInterval(timer);return pending||Promise.resolve()}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const[action,source,target]=process.argv.slice(2);
  if(action==='verify'&&source)console.log(JSON.stringify(await verifyBackup(source)));
  else if(action==='restore'&&source&&target)console.log(JSON.stringify(await restoreBackup(source,target)));
  else if(action==='create'&&source&&target){const db=new DatabaseSync(source,{readOnly:true});try{console.log(JSON.stringify(await createVerifiedBackup(db,target)))}finally{db.close()}}
  else throw new Error('Usage: node backup.mjs create DB BACKUP_DIR | verify SNAPSHOT | restore SNAPSHOT NEW_DB');
 }catch(e){console.error(e.message);process.exitCode=1}
}
