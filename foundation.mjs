import {randomUUID} from 'node:crypto';
const reject=(status,message)=>{throw Object.assign(new Error(message),{status})};
const types={
 'seed-packets':{fields:['name','variety','brand','mediaIds','instructions','sources'],required:['name']},
 'seed-projects':{fields:['name','packetId','plantId','growingMethod','sowingDate','stage','sources'],required:['name']},
 conversations:{fields:['title','plantId','projectId'],required:['title']},
 'grow-plans':{fields:['title','projectId','instructions','sources'],required:['title','projectId']},
 'rescue-plans':{fields:['title','plantId','objective','instructions','sources'],required:['title','plantId']}
};
export function createFoundation(db,{ownedRecord}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS foundation_records(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS foundation_owner_kind ON foundation_records(owner,kind);
 CREATE TABLE IF NOT EXISTS foundation_versions(record_id TEXT NOT NULL REFERENCES foundation_records(id),revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(record_id,revision));
 CREATE TABLE IF NOT EXISTS foundation_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES foundation_records(id),body TEXT NOT NULL);`);
 const read=(owner,kind,id)=>{const r=db.prepare('SELECT body FROM foundation_records WHERE owner=? AND kind=? AND id=?').get(owner,kind,id);if(!r)reject(404,'Record not found.');return JSON.parse(r.body)};
 const text=(v,key,max=4000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)reject(400,`Invalid ${key}.`);return v.trim()};
 function validate(owner,kind,input){
  if(!input||typeof input!=='object'||Array.isArray(input))reject(400,'Expected an object.');
  const spec=types[kind],out={};
  for(const key of Object.keys(input)){
   if(!spec.fields.includes(key))reject(400,`Unsupported field: ${key}.`);
   const value=input[key];
   if(key==='mediaIds'){
    if(!Array.isArray(value)||value.length>8)reject(400,'Use at most eight photos.');
    out[key]=value.map(id=>{text(id,'photo id',100);ownedRecord('media',id,owner);return id});
   }else if(key==='sources'){
    if(!Array.isArray(value)||value.length>30)reject(400,'Invalid sources.');
    out.sources=value.map(s=>{if(!s||typeof s!=='object'||!['packet','manufacturer','extension','reference','ai'].includes(s.type))reject(400,'Invalid source type.');const result={type:s.type,label:text(s.label,'source label',300)};if(s.url){let url;try{url=new URL(s.url)}catch{reject(400,'Invalid source URL.')}if(url.protocol!=='https:')reject(400,'Source URLs must use HTTPS.');result.url=url.href}return result});
   }else out[key]=text(value,key,['instructions','objective'].includes(key)?10000:200);
  }
  for(const key of spec.required)if(!out[key])reject(400,`${key} is required.`);
  if(out.plantId)ownedRecord('plant',out.plantId,owner);
  if(out.packetId)read(owner,'seed-packets',out.packetId);
  if(out.projectId)read(owner,'seed-projects',out.projectId);
  if(kind==='conversations'&&!!out.plantId===!!out.projectId)reject(400,'Choose exactly one plant or seed project.');
  if(out.growingMethod&&!['indoor','outdoor','indoor-to-outdoor','container'].includes(out.growingMethod))reject(400,'Invalid growing method.');
  if(out.stage&&!['planned','sown','germinating','germinated','seedling','hardening-off','transplanting','established','growing','flowering','fruiting','harvesting','completed','discontinued'].includes(out.stage))reject(400,'Invalid lifecycle stage.');
  if(out.sowingDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(out.sowingDate)||!Number.isFinite(Date.parse(out.sowingDate))||new Date(out.sowingDate).toISOString().slice(0,10)!==out.sowingDate))reject(400,'Invalid sowing date.');
  return out;
 }
 function write(owner,kind,input,id,expectedRevision,withinTransaction=false){
  if(!withinTransaction)db.exec('BEGIN IMMEDIATE');
  try{
   const previous=id?read(owner,kind,id):null;
   if(previous&&expectedRevision!==previous.revision)reject(409,'The record changed. Reload before saving.');
   // Links are immutable after creation; moving a conversation or plan would mix histories.
   if(previous)for(const key of ['plantId','projectId','packetId'])if(input[key]!==undefined&&input[key]!==previous[key])reject(400,'Record links cannot be changed.');
   const fields=validate(owner,kind,{...(previous?Object.fromEntries(types[kind].fields.filter(k=>previous[k]!==undefined).map(k=>[k,previous[k]])):{}),...input});
   const stamp=new Date().toISOString(),record={...fields,id:id||randomUUID(),schemaVersion:1,revision:(previous?.revision||0)+1,created:previous?.created||stamp,updated:stamp};
   db.prepare('INSERT INTO foundation_records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(record.id,owner,kind,record.revision,JSON.stringify(record));
   db.prepare('INSERT INTO foundation_versions VALUES(?,?,?)').run(record.id,record.revision,JSON.stringify(record));
   if(!withinTransaction)db.exec('COMMIT');return record;
  }catch(e){if(!withinTransaction)db.exec('ROLLBACK');throw e}
 }
 return {
  createProject(owner,input,key){
   text(key,'request key',100);if(!input||typeof input!=='object'||!input.packet||!input.project)reject(400,'Packet and project details are required.');
   const requestKey='seed-project:'+key;
   db.exec('BEGIN IMMEDIATE');try{
    const previous=db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(owner,requestKey);
    if(previous){const saved=JSON.parse(previous.response);if(saved.input!==JSON.stringify(input))reject(409,'This save key belongs to different details. Retry the original save or start a new draft.');db.exec('COMMIT');return saved.result}
    const packet=write(owner,'seed-packets',input.packet,undefined,undefined,true);
    const project=write(owner,'seed-projects',{...input.project,packetId:packet.id},undefined,undefined,true);
    const result={packet,project};db.prepare('INSERT INTO requests VALUES(?,?,?)').run(owner,requestKey,JSON.stringify({input:JSON.stringify(input),result}));
    db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e}
  },
  supports:kind=>Object.hasOwn(types,kind),read,write,
  list:(owner,kind)=>db.prepare('SELECT body FROM foundation_records WHERE owner=? AND kind=? ORDER BY rowid DESC LIMIT 200').all(owner,kind).map(r=>JSON.parse(r.body)),
  versions(owner,kind,id){read(owner,kind,id);return db.prepare('SELECT body FROM foundation_versions WHERE record_id=? ORDER BY revision').all(id).map(r=>JSON.parse(r.body))},
  messages(owner,id){read(owner,'conversations',id);return db.prepare('SELECT body FROM foundation_messages WHERE conversation_id=? ORDER BY rowid LIMIT 500').all(id).map(r=>JSON.parse(r.body))},
  append(owner,id,input){read(owner,'conversations',id);if(Object.keys(input).some(k=>!['text','mediaIds'].includes(k)))reject(400,'Unsupported message field.');const message={id:randomUUID(),role:'user',text:text(input.text,'message',10000),mediaIds:[],created:new Date().toISOString()};if(input.mediaIds){if(!Array.isArray(input.mediaIds)||input.mediaIds.length>8)reject(400,'Invalid photos.');message.mediaIds=input.mediaIds.map(id=>{text(id,'photo id',100);ownedRecord('media',id,owner);return id})}db.prepare('INSERT INTO foundation_messages VALUES(?,?,?)').run(message.id,id,JSON.stringify(message));return message}
 };
}
