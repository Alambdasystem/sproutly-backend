import {scryptSync,timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function createAccountControls(db,{forget=()=>{}}={}){
 return{export(owner,includePhotos=false){
  const user=db.prepare('SELECT id,name,email,created FROM users WHERE id=?').get(owner);const records=db.prepare('SELECT kind,body FROM records WHERE owner=?').all(owner).map(r=>({kind:r.kind,...JSON.parse(r.body)}));
  const bytes=records.filter(r=>r.kind==='media').reduce((sum,r)=>sum+(r.data?.length||0),0);if(includePhotos&&bytes>20000000)fail(413,'Photo export exceeds the 20 MB pilot limit. Export records without photos and download individual photos from your garden.');
  if(!includePhotos)for(const r of records)if(r.kind==='media')delete r.data;
  const foundation=db.prepare('SELECT kind,body FROM foundation_records WHERE owner=?').all(owner).map(r=>({kind:r.kind,...JSON.parse(r.body)}));
  const messages=db.prepare('SELECT m.body FROM foundation_messages m JOIN foundation_records r ON r.id=m.conversation_id WHERE r.owner=? ORDER BY m.rowid').all(owner).map(r=>JSON.parse(r.body));
  const versions=db.prepare('SELECT v.body FROM foundation_versions v JOIN foundation_records r ON r.id=v.record_id WHERE r.owner=? ORDER BY v.revision').all(owner).map(r=>JSON.parse(r.body));
  return{exportedAt:new Date().toISOString(),formatVersion:1,user,photosIncluded:includePhotos,records,foundation,messages,versions,notice:'Session tokens, password hashes, reset links and service credentials are excluded.'};
 },remove(user,body){
  if(body.confirmation!=='DELETE'||body.acknowledgeSubscription!==true)fail(400,'Type DELETE and acknowledge that deleting the account does not cancel an app-store subscription.');
  if(!user.demo){if(typeof body.password!=='string'||body.password.length>200||!user.password)fail(401,'Enter your current password.');const [salt,hash]=user.password.split(':'),actual=scryptSync(body.password,salt,64),expected=Buffer.from(hash,'hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail(401,'The current password is incorrect.');}
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare('DELETE FROM foundation_messages WHERE conversation_id IN (SELECT id FROM foundation_records WHERE owner=?)').run(user.id);db.prepare('DELETE FROM foundation_versions WHERE record_id IN (SELECT id FROM foundation_records WHERE owner=?)').run(user.id);db.prepare('DELETE FROM foundation_records WHERE owner=?').run(user.id);
   for(const [table,column] of [['requests','owner'],['payment_checkouts','owner'],['records','owner'],['sessions','user_id'],['account_tokens','user_id'],['account_security','user_id']])db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(user.id);
   db.prepare('DELETE FROM users WHERE id=?').run(user.id);db.exec('COMMIT');forget(user.id);return{deleted:true,notice:'Live account records and sessions were removed. Existing rolling local backups expire under the seven-snapshot retention policy. App-store subscriptions must be managed separately.'};
  }catch(e){db.exec('ROLLBACK');throw e}
 }};
}
