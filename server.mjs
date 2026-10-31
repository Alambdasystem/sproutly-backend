import http from 'node:http';
import {createFoundation} from './foundation.mjs';
import {createCare} from './care.mjs';
import {createMembership} from './membership.mjs';
import {createAccountControls} from './account-controls.mjs';
import {weatherForecast} from './weather.mjs';
import {transcribeVoice} from './transcription.mjs';
import {extractPacket} from './packet-extraction.mjs';
import {preparePacketImage} from './packet-images.mjs';
import {validateConfirmedFields} from './packet-schema.mjs';
import {createAccounts} from './accounts.mjs';
import {createOffsite} from './offsite.mjs';
import {createPayments} from './payments.mjs';
import {analyzePlant} from './vision.mjs';
import {catalog,searchPlants} from './catalog.mjs';
import {searchMarketplace} from './marketplace.mjs';
import {requireMountedStorage} from './storage.mjs';
import {startBackupSchedule} from './backup.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync,chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const str=(v,name,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,`${name} is required (maximum ${max} characters).`);return v.trim()};
const pick=(v,values,name)=>{if(!values.includes(v))fail(400,`Invalid ${name}.`);return v};
const now=()=>new Date().toISOString();
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,demo:!!u.demo});
export function createApp({dbPath=process.env.DATABASE_PATH||'data/sproutly.sqlite',origins=(process.env.CORS_ORIGINS||'http://localhost:8081,http://localhost:19006').split(','),analyzer=analyzePlant,packetExtractor=extractPacket,careAI,membershipOptions={},voiceTranscriber=transcribeVoice,weatherLookup=weatherForecast,plantSearch=searchPlants,marketplaceSearch=searchMarketplace,backupEnabled=process.env.BACKUP_ENABLED==='true',backupDir=process.env.BACKUP_DIR||dirname(dbPath)+'/backups',accountOptions={},requiredMount=process.env.REQUIRE_PERSISTENT_STORAGE==='true'?(process.env.PERSISTENT_DATA_DIR||'/var/data'):null}={}){
 const storage=requireMountedStorage({dbPath,mountPath:requiredMount,backupDir:backupEnabled?backupDir:null});
 if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(dbPath);if(dbPath!==':memory:')chmodSync(dbPath,0o600); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,demo INTEGER,created TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT,owner TEXT,body TEXT);
 CREATE INDEX IF NOT EXISTS records_owner ON records(kind,owner);
 CREATE TABLE IF NOT EXISTS requests(owner TEXT,key TEXT,response TEXT,PRIMARY KEY(owner,key));`);
 const payments=createPayments(db);
 const accounts=createAccounts(db,accountOptions);
 const userView=u=>({...publicUser(u),emailVerified:accounts.verified(u.id)});
 const offsite=createOffsite();
 const backups=backupEnabled&&dbPath!==':memory:'?startBackupSchedule(db,{onVerified:offsite.upload,directory:backupDir,intervalHours:Number(process.env.BACKUP_INTERVAL_HOURS||24),keep:Number(process.env.BACKUP_KEEP||7)}):null;
 const list=(kind,owner)=>db.prepare('SELECT * FROM records WHERE kind=? AND owner=?').all(kind,owner).map(r=>JSON.parse(r.body));
 const get=(kind,id,owner)=>{const r=db.prepare('SELECT * FROM records WHERE kind=? AND id=? AND owner=?').get(kind,id,owner);if(!r)fail(404,'Record not found.');return JSON.parse(r.body)};
 const save=(kind,owner,data)=>{db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)').run(data.id,kind,owner,JSON.stringify(data));return data};
 const foundation=createFoundation(db,{ownedRecord:get});
 const membership=createMembership(db,membershipOptions);
 const accountControls=createAccountControls(db,{forget:membership.forget});
 const care=createCare({db,foundation,get,list,save,ai:careAI,access:membership.access,busy:()=>activeAnalyses>0||activePacketExtractions>0||activePhotoEdits>0||activeAudio>0});
 const audit=(u,action,target)=>save('audit',u.id,{id:randomUUID(),action,target,actor:u.name,at:now()});
 function seed(u){
  const date=now();
  const plants=[{id:randomUUID(),name:'Sweet basil',species:'Ocimum basilicum',stage:'Seedling',location:'Kitchen windowsill',status:'Not assessed',image:'basil',created:date},{id:randomUUID(),name:'Monstera',species:'Monstera deliciosa',stage:'Established',location:'Living room',status:'Not assessed',image:'monstera',created:date},{id:randomUUID(),name:'Little beginnings',species:'Cherry tomato',stage:'Sprout',location:'Patio',status:'Not assessed',image:'sprout',created:date}];
  plants.forEach(p=>{save('plant',u.id,p);save('journal',u.id,{id:randomUUID(),plantId:p.id,type:'Milestone',note:`Added ${p.name} to my garden.`,created:date});});
  plants.slice(0,2).forEach(p=>save('task',u.id,{id:randomUUID(),plantId:p.id,title:`Check soil for ${p.name}`,due:date,done:false}));
  save('provider',u.id,{id:'local-growers-'+u.id,name:'Root & Rise Nursery',area:'St. Louis, MO',status:'approved',pickup:'Sample pickup location — arrange after ordering',created:date});
  seedCatalog(u);
  save('provider',u.id,{id:randomUUID(),name:'Seed & Stem Collective',area:'St. Louis, MO',status:'pending',created:date});
 }
 function seedCatalog(u){
  if(list('catalog_version',u.id).some(v=>v.version===2))return;
  const providerId='local-growers-'+u.id;
  if(!list('provider',u.id).some(p=>p.id===providerId))save('provider',u.id,{id:providerId,name:'Root & Rise Nursery (sample)',area:'St. Louis, MO',status:'approved',sample:true});
  const current=list('listing',u.id);
  for(const item of catalog){const old=current.find(p=>p.sku===item.sku)||current.find(p=>!p.sku&&['Genovese basil','Cherry tomato seeds','Monstera cutting'].includes(p.name)&&p.species===item.species&&p.type===item.type);save('listing',u.id,{...item,id:old?.id||randomUUID(),providerId,provider:'Root & Rise Nursery (sample)',area:'St. Louis, MO',active:old?old.active:true,stock:old?old.stock:item.stock});}
  save('catalog_version',u.id,{id:'catalog-version-'+u.id,version:2});
 }
 let stopping=false;
 let activeAnalyses=0,activePacketExtractions=0,activePhotoEdits=0,activeAudio=0;
 const referenceCache=new Map();
 const merchantCache=new Map();const merchantPending=new Map();
 function session(u){const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,Date.now()+7*864e5);return{token,user:userView(u)}}
 for(const record of db.prepare("SELECT * FROM records WHERE kind='assessment'").all()){const a=JSON.parse(record.body);if(['queued','running'].includes(a.status))save('assessment',record.owner,{...a,status:'failed',error:'The server restarted during analysis. Your photo is saved; please retry.'})}
 for(const record of db.prepare("SELECT * FROM records WHERE kind='packet_extraction'").all()){const job=JSON.parse(record.body);if(['queued','running'].includes(job.status))save('packet_extraction',record.owner,{...job,status:'failed',error:'The server restarted during this scan. Your photos are saved; retry the scan.'})}
 const rate=new Map();
 const server=http.createServer(async(req,res)=>{
  const requestId=randomUUID(),started=performance.now();res.setHeader('X-Request-ID',requestId);res.once('finish',()=>{if(process.env.REQUEST_METRICS==='true')console.log(JSON.stringify({event:'api_request',requestId,method:req.method,status:res.statusCode,durationMs:Math.round(performance.now()-started)}))});
  const origin=req.headers.origin;
  if(origin&&origins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
  res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,Idempotency-Key');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
   if(path==='/health')return send(200,{status:'ok',service:'sproutly-backend',mode:'demo-data',storage:storage.persistent?'persistent':'ephemeral',backups:{...(backups?.status||{enabled:false}),offsite:offsite.status}});
   let rawBody=Buffer.alloc(0);let body={};if(['POST','PATCH','DELETE'].includes(method)){let chunks=[],length=0;for await(const chunk of req){length+=chunk.length;if(length>5_500_000)fail(413,'Request too large.');chunks.push(chunk)}rawBody=Buffer.concat(chunks);try{body=JSON.parse(rawBody.toString()||'{}')}catch{fail(400,'Invalid JSON.')}}
   if(path==='/api/v1/membership/webhook'&&method==='POST')return send(200,await membership.webhook(body,req.headers.authorization));
   if(path==='/api/v1/payments/webhook'&&method==='POST')return send(200,await payments.webhook(rawBody,req.headers['stripe-signature']));
   if(path.startsWith('/api/v1/auth/')&&method==='POST'){
    const ip=req.socket.remoteAddress;const r=rate.get(ip)||{count:0,until:Date.now()+60000};if(r.until<Date.now()){r.count=0;r.until=Date.now()+60000}if(++r.count>40)fail(429,'Please wait before trying again.');rate.set(ip,r);
    if(['/api/v1/auth/reset','/api/v1/auth/reset-confirm','/api/v1/auth/verify'].includes(path))return send(200,await accounts.route(path,body));
    if(path.endsWith('/demo')){if(process.env.DEMO_ENABLED==='false')fail(404,'Demo is disabled.');const u={id:randomUUID(),name:'Garden explorer',email:`demo-${randomUUID()}@example.invalid`,password:'',role:'admin',demo:1,created:now()};db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(u.id,u.name,u.email,u.password,u.role,1,u.created);seed(u);return send(201,session(u))}
    if(path.endsWith('/register')){const email=str(body.email,'Email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Enter a valid email.');const pw=str(body.password,'Password',200);if(pw.length<10)fail(400,'Use at least 10 characters for your password.');if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail(409,'This email is already registered.');const salt=randomBytes(16).toString('hex');const u={id:randomUUID(),name:str(body.name,'Name',80),email,password:salt+':'+scryptSync(pw,salt,64).toString('hex'),role:'grower',demo:0,created:now()};db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(u.id,u.name,u.email,u.password,u.role,0,u.created);const emailDelivery=await accounts.issue(u,'verify');return send(201,{...session(u),emailDelivery})}
    if(path.endsWith('/login')){const email=str(body.email,'Email').toLowerCase(),pw=str(body.password,'Password');const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u?.password)fail(401,'Email or password is incorrect.');const[salt,hash]=u.password.split(':');if(!timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(pw,salt,64)))fail(401,'Email or password is incorrect.');return send(200,session(u))}

   }
   const token=(req.headers.authorization||'').replace(/^Bearer /,'');const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,Date.now());if(!s)fail(401,'Please sign in.');const u=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
   const requireRole=(...roles)=>{if(!roles.includes(u.role))fail(403,'Your account does not have permission for this action.')};
   if(path==='/api/v1/auth/verification'&&method==='POST')return send(200,await accounts.route(path,body,u));
   if(path==='/api/v1/auth/logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);return send(200,{ok:true})}
   if(path==='/api/v1/membership'&&method==='GET')return send(200,{...await membership.status(u.id),limits:{plants:3,identificationsPerWeek:3,questionsPerMonth:3,diagnosesPerMonth:1,complimentaryRescues:1}});
   if(path==='/api/v1/membership/refresh'&&method==='POST')return send(200,await membership.status(u.id,true));
   if(path==='/api/v1/account/export'&&method==='GET')return send(200,accountControls.export(u.id,url.searchParams.get('photos')==='true'));
   if(path==='/api/v1/account'&&method==='DELETE')return send(200,accountControls.remove(u,body));
   if(path==='/api/v1/voice/transcribe'&&method==='POST'){
    await membership.access(u.id,'voice');if(activeAudio||activeAnalyses||activePacketExtractions||activePhotoEdits||care.isBusy())fail(429,'Audio/image processing is busy. Please retry shortly.');
    const day=now().slice(0,10);if(list('voice_usage',u.id).filter(r=>r.created.startsWith(day)).length>=10)fail(429,'The daily voice limit has been reached. You can type instead.');activeAudio++;
    try{const result=await voiceTranscriber(body);if(!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))fail(401,'This account was removed.');save('voice_usage',u.id,{id:randomUUID(),created:now(),model:result.model});return send(200,result)}finally{activeAudio--}
   }
   if(path==='/api/v1/weather/forecast'&&method==='POST'){
    foundation.read(u.id,'seed-projects',body.projectId);const result=await weatherLookup(body,{evaluation:!!u.demo});if(!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))fail(401,'This account was removed.');return send(200,save('weather_context',u.id,{...result,id:randomUUID(),projectId:body.projectId}));
   }
   if(path==='/api/v1/support'&&method==='POST')return send(201,save('support',u.id,{id:randomUUID(),message:str(body.message,'Support message',4000),status:'saved',created:now(),notice:'Saved in your account. For a response, contact the support email shown in Help.'}));
   if(path==='/api/v1/operations'&&method==='GET'){requireRole('admin');return send(200,{scope:'current-account',careJobs:list('care_job',u.id).map(j=>({id:j.id,type:j.type,status:j.status,created:j.created,usage:j.usage,model:j.model})),packetJobs:list('packet_extraction',u.id).map(j=>({id:j.id,status:j.status,created:j.created,usage:j.usage,model:j.model})),voiceRequests:list('voice_usage',u.id).length,localBackups:backups?.status||{enabled:false},offsite:offsite.status})}
   if(path==='/api/v1/me'&&method==='GET')return send(200,userView(u));
   if(path==='/api/v1/bootstrap'&&method==='GET'){seedCatalog(u);return send(200,{user:userView(u),plants:list('plant',u.id),tasks:[...list('task',u.id),...list('seed_task',u.id).filter(t=>!t.cancelled)],journal:list('journal',u.id),stories:list('story',u.id),assessments:list('assessment',u.id),listings:list('listing',u.id).filter(p=>p.active),orders:list('order',u.id),providers:list('provider',u.id),audit:u.role==='admin'?list('audit',u.id):[],mode:'seeded-demo',integrations:{assessments:process.env.OPENAI_API_KEY?'openai':'not-configured',plantReferences:'gbif',supplierInventory:'deep-harvest-public-catalog',sampleCatalog:true,payments:payments.status(),sampleCheckout:'simulated',email:accounts.configured()?'configured':'not-configured'}});}
   const parts=path.split('/').filter(Boolean),resource=parts[2],id=parts[3];
   if(path.startsWith('/api/v1/care/')){const result=await care.route({owner:u.id,parts:parts.slice(3),method,body,key:req.headers['idempotency-key']});return send(result.status,result.data);}
   if(path==='/api/v1/packet-media/prepare'&&method==='POST'){
    if(activePhotoEdits||activePacketExtractions||activeAnalyses||activeAudio||care.isBusy())fail(429,'Photo processing is busy. Please retry shortly.');
    const media=get('media',str(body.mediaId,'Photo id',100),u.id);activePhotoEdits++;
    try{const result=await preparePacketImage(media.data,{rotation:body.rotation??0,crop:body.crop});if(!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))fail(401,'This account was removed.');const edited=save('media',u.id,{id:randomUUID(),data:result.data,originalMediaId:media.originalMediaId||media.id,created:now()});return send(201,{...result,id:edited.id,originalMediaId:edited.originalMediaId})}finally{activePhotoEdits--}
   }
   if(parts[0]==='api'&&parts[1]==='v1'&&resource==='packet-extractions'){
    if(method==='GET'&&id&&parts.length===4)return send(200,get('packet_extraction',id,u.id));
    if(method==='POST'&&!id){
     if(body.consent!==true)fail(400,'Confirm sending the packet photos and recognized text to OpenAI.');
     if(!Array.isArray(body.photos)||!body.photos.length||body.photos.length>4)fail(400,'Upload one to four packet photos. Front and back are recommended.');
     const photos=body.photos.map(p=>{if(!p||!['front','back','instructions','barcode'].includes(p.side))fail(400,'Choose a packet photo side.');const media=get('media',str(p.mediaId,'Photo id',100),u.id);if(media.originalMediaId)get('media',media.originalMediaId,u.id);return{mediaId:media.id,originalMediaId:media.originalMediaId||media.id,side:p.side}});
     const key='packet-extraction:'+str(req.headers['idempotency-key'],'Scan request key',100),previous=db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(u.id,key);
     if(previous){const job=get('packet_extraction',JSON.parse(previous.response).id,u.id);if(JSON.stringify(job.photos)!==JSON.stringify(photos))fail(409,'This scan key belongs to different photos. Start a new scan.');return send(200,job)}
     await membership.access(u.id,'seed');
     if(packetExtractor===extractPacket&&!process.env.OPENAI_API_KEY)fail(503,'Seed packet extraction is not configured.');
     if(activePacketExtractions||activeAnalyses||activePhotoEdits||activeAudio||care.isBusy())fail(429,'Photo processing is busy. Please retry shortly.');
     const day=now().slice(0,10),daily=db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='packet_extraction' AND json_extract(body,'$.created')>=?").get(day).n;
     if(daily>=Number(process.env.PACKET_DAILY_LIMIT||50)||list('packet_extraction',u.id).filter(j=>j.created.startsWith(day)).length>=5)fail(429,'The daily packet scan limit has been reached. Use manual entry or try tomorrow.');
     const job={id:randomUUID(),photos,status:'queued',created:now(),consentAt:now(),provider:'OpenAI',schemaVersion:1};save('packet_extraction',u.id,job);db.prepare('INSERT INTO requests VALUES(?,?,?)').run(u.id,key,JSON.stringify({id:job.id}));activePacketExtractions++;
     setImmediate(async()=>{try{if(stopping||!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))return;job.status='running';save('packet_extraction',u.id,job);const result=await packetExtractor({photos:photos.map(p=>({...p,data:get('media',p.mediaId,u.id).data}))});if(stopping||!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))return;Object.assign(job,result,{status:'completed',completed:now()});if(!photos.some(p=>p.side==='back'))job.warnings=[...(job.warnings||[]),'No back panel was supplied. Photograph every instruction panel to avoid missing important details.'];save('packet_extraction',u.id,job)}catch(e){if(stopping||!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))return;job.status='failed';job.error=e.message||'Packet scan failed. Please retry.';save('packet_extraction',u.id,job)}finally{activePacketExtractions--}});
     return send(202,job);
    }
    if(method==='POST'&&id&&parts[4]==='confirm'&&parts.length===5){
     const job=get('packet_extraction',id,u.id);if(!['completed','confirmed'].includes(job.status)||job.imageQuality!=='usable')fail(409,'Use readable seed packet photos or continue with manual entry.');
     if(body.confirmed!==true)fail(400,'Review the fields and confirm them before continuing.');
     const values=validateConfirmedFields(body.values);for(const f of job.fields)if(f.value&&!Object.hasOwn(values,f.key))fail(400,'Review or clear every extracted value.');
     if(job.status==='confirmed'){if(JSON.stringify(job.confirmedFields)===JSON.stringify(values))return send(200,job);fail(409,'This extraction was already confirmed. Start a new scan to change its confirmed record.');}
     job.confirmedFields=values;job.status='confirmed';job.confirmedAt=now();save('packet_extraction',u.id,job);return send(200,job);
    }
    fail(404,'Endpoint not found.');
   }
   if(path==='/api/v1/seed-projects/from-packet'&&method==='POST'){await membership.access(u.id,'seed');return send(201,foundation.createProject(u.id,body,req.headers['idempotency-key']));}
   if(parts[0]==='api'&&parts[1]==='v1'&&foundation.supports(resource)){
    if(parts.length>5)fail(404,'Endpoint not found.');
    const sub=parts[4];
    if(sub==='versions'&&id&&method==='GET')return send(200,foundation.versions(u.id,resource,id));
    if(sub==='messages'&&resource==='conversations'&&id){
     if(method==='GET')return send(200,foundation.messages(u.id,id));
     if(method==='POST')return send(201,foundation.append(u.id,id,body));
    }
    if(sub)fail(404,'Endpoint not found.');
    if(method==='GET')return send(200,id?foundation.read(u.id,resource,id):foundation.list(u.id,resource));
    if(method==='POST'&&!id){if(['seed-packets','seed-projects','grow-plans'].includes(resource))await membership.access(u.id,'seed');return send(201,foundation.write(u.id,resource,body));}
    if(method==='PATCH'&&id){const {revision,...changes}=body;return send(200,foundation.write(u.id,resource,changes,id,revision));}
    fail(405,'Method not allowed.');
   }
   if(resource==='plants'){
    if(method==='GET')return send(200,id?get('plant',id,u.id):list('plant',u.id));
    if(method==='POST'){await membership.access(u.id,'plant');if(body.mediaId)get('media',body.mediaId,u.id);const p=save('plant',u.id,{id:randomUUID(),name:str(body.name,'Plant name',80),species:str(body.species||'Unknown','Species',120),stage:pick(body.stage||'Seed','Seed Germination Sprout Seedling Established Harvest Dormancy'.split(' '),'stage'),location:str(body.location||'Not specified','Location'),image:body.mediaId?'media':body.image||'sprout',mediaId:body.mediaId||null,status:'Not assessed',created:now()});if(p.mediaId)get('media',p.mediaId,u.id);save('journal',u.id,{id:randomUUID(),plantId:p.id,type:'Milestone',note:`Added ${p.name} to my garden.`,created:now()});return send(201,p)}
    if(method==='PATCH'){const p=get('plant',id,u.id);for(const key of ['name','species','location'])if(body[key]!==undefined)p[key]=str(body[key],key);if(body.stage)p.stage=pick(body.stage,['Seed','Germination','Sprout','Seedling','Established','Harvest','Dormancy'],'stage');return send(200,save('plant',u.id,p))}
    if(method==='DELETE'){get('plant',id,u.id);if(db.prepare("SELECT 1 FROM foundation_records WHERE owner=? AND json_extract(body,'$.plantId')=? LIMIT 1").get(u.id,id)||list('rescue_plan',u.id).some(p=>p.plantId===id))fail(409,'This plant has linked seed, conversation, or rescue history.');for(const kind of ['journal','task','assessment','story'])for(const r of list(kind,u.id))if(r.plantId===id)db.prepare('DELETE FROM records WHERE id=? AND owner=?').run(r.id,u.id);db.prepare('DELETE FROM records WHERE id=? AND owner=?').run(id,u.id);return send(200,{ok:true})}
   }
   if(resource==='media'){
    if(method==='POST'){const data=str(body.data,'Image',5_400_000);if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data))fail(400,'Use a JPEG, PNG, or WebP image.');const p=save('media',u.id,{id:randomUUID(),data,created:now()});return send(201,{id:p.id})}
    if(method==='GET')return send(200,get('media',id,u.id));
   }
   if(resource==='journal'){
    if(method==='POST'){get('plant',body.plantId,u.id);if(body.mediaId)get('media',body.mediaId,u.id);return send(201,save('journal',u.id,{id:randomUUID(),plantId:body.plantId,type:pick(body.type||'Note',['Note','Watering','Feeding','Repotting','Pruning','Milestone'],'entry type'),note:str(body.note,'Note',3000),mediaId:body.mediaId||null,created:now()}))}
    if(method==='PATCH'){const e=get('journal',id,u.id);e.note=str(body.note,'Note',3000);return send(200,save('journal',u.id,e))}
    if(method==='DELETE'){get('journal',id,u.id);db.prepare('DELETE FROM records WHERE id=? AND owner=?').run(id,u.id);return send(200,{ok:true})}
   }
   if(resource==='tasks'){
    if(method==='POST'){get('plant',body.plantId,u.id);if(!Number.isFinite(Date.parse(body.due)))fail(400,'Enter a valid due date.');return send(201,save('task',u.id,{id:randomUUID(),plantId:body.plantId,title:str(body.title,'Task title'),due:new Date(body.due).toISOString(),done:false}))}
    if(method==='PATCH'){const t=get('task',id,u.id);if(typeof body.done==='boolean')t.done=body.done;if(body.due){if(!Number.isFinite(Date.parse(body.due)))fail(400,'Invalid date.');t.due=new Date(body.due).toISOString()}return send(200,save('task',u.id,t))}
   }
   if(resource==='assessments'){
    if(method==='GET')return send(200,get('assessment',id,u.id));
    if(method==='POST'){
     const plant=get('plant',body.plantId,u.id);
     if(body.consent!==true)fail(400,'Confirm that your photo and growing context can be sent to OpenAI for analysis.');
     if(!body.mediaId)fail(400,'Add a plant photograph before requesting analysis.');
     const media=get('media',body.mediaId,u.id),symptoms=str(body.symptoms||'Assess the visible plant condition.','Observed symptoms',1200);
     if(analyzer===analyzePlant&&!process.env.OPENAI_API_KEY)fail(503,'Image analysis is not configured. Please try again later.');
     const key=str(req.headers['idempotency-key'],'Assessment request key',100),previous=db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(u.id,'assessment:'+key);
     if(previous)return send(200,get('assessment',JSON.parse(previous.response).id,u.id));
     await membership.access(u.id,body.purpose==='identify'?'identify':'diagnose');
     const day=now().slice(0,10),daily=db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='assessment' AND json_extract(body,'$.created')>=?").get(day).n;
     if(daily>=Number(process.env.ANALYSIS_DAILY_LIMIT||100)||list('assessment',u.id).filter(a=>a.created.startsWith(day)).length>=10)fail(429,'The daily photo analysis limit has been reached. Please try again tomorrow.');
     if(activeAnalyses>=2||activePacketExtractions||activePhotoEdits||activeAudio||care.isBusy())fail(429,'The plant doctor is busy. Please retry shortly.');
     if(list('assessment',u.id).some(a=>['queued','running'].includes(a.status)))fail(409,'A plant assessment is already running for your garden.');
     const a={id:randomUUID(),plantId:plant.id,status:'queued',purpose:body.purpose==='identify'?'identify':'diagnose',simulated:false,provider:'OpenAI',mediaId:body.mediaId,observations:symptoms,userObservations:symptoms,context:{watering:typeof body.watering==='string'?body.watering.slice(0,800):'Unknown',light:typeof body.light==='string'?body.light.slice(0,800):'Unknown'},created:now(),consentAt:now()};
     save('assessment',u.id,a);db.prepare('INSERT INTO requests VALUES(?,?,?)').run(u.id,'assessment:'+key,JSON.stringify({id:a.id}));activeAnalyses++;
     setImmediate(async()=>{try{if(stopping||!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))return;a.status='running';save('assessment',u.id,a);const result=await analyzer({image:media.data,plant,symptoms,watering:a.context.watering,light:a.context.light});if(stopping||!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))return;Object.assign(a,result,{status:result.imageQuality==='usable'?'completed':'inconclusive',completed:now()});save('assessment',u.id,a);save('journal',u.id,{id:randomUUID(),plantId:plant.id,type:'Assessment',note:`Photo assessment: ${a.observations}`,assessmentId:a.id,mediaId:body.mediaId,created:now()});}catch(e){if(stopping||!db.prepare('SELECT id FROM users WHERE id=?').get(u.id))return;a.status='failed';a.error=e.message||'Image analysis could not complete.';save('assessment',u.id,a);}finally{activeAnalyses--;}});
     return send(202,{id:a.id,plantId:a.plantId,status:a.status,simulated:false,provider:'OpenAI'});
    }
   }
   if(resource==='stories'){
    if(method==='POST'){const p=get('plant',body.plantId,u.id),entries=list('journal',u.id).filter(e=>e.plantId===p.id);const text=entries.map(e=>`${new Date(e.created).toLocaleDateString('en-US',{timeZone:'UTC'})}: ${e.note}`).join('\n');return send(201,save('story',u.id,{id:randomUUID(),plantId:p.id,title:`${p.name}'s growing story`,text:text||'Your growing story starts with your first journal entry.',privacy:'private',generated:true,created:now()}))}
    if(method==='PATCH'){const s=get('story',id,u.id);s.text=str(body.text,'Story',10000);return send(200,save('story',u.id,s))}
   }
   if(resource==='plant-search'&&method==='GET'){const q=str(url.searchParams.get('q'),'Plant search',100),cached=referenceCache.get(q.toLowerCase());if(cached&&Date.now()-cached.at<86400000)return send(200,{results:cached.results,source:'GBIF',cached:true});try{const results=await plantSearch(q);if(referenceCache.size>250)referenceCache.clear();referenceCache.set(q.toLowerCase(),{at:Date.now(),results});return send(200,{results,source:'GBIF',cached:false})}catch{fail(502,'Plant reference lookup is temporarily unavailable. Please retry.')}}
   if(path==='/api/v1/marketplace/search'&&method==='GET'){
    const q=str(url.searchParams.get('q')||'basil','Product search',100);if(q.length<2)fail(400,'Enter at least two characters.');
    const pageText=url.searchParams.get('page')||'1';if(!/^[1-5]$/.test(pageText))fail(400,'Page must be between 1 and 5.');const page=Number(pageText),cacheKey=q.toLowerCase()+':'+page;
    const cached=merchantCache.get(cacheKey);if(cached&&Date.now()-cached.at<900000)return send(200,{...cached.data,cached:true});
    if(!merchantPending.has(cacheKey)&&merchantPending.size>=3)fail(429,'The shop search is busy. Please retry shortly.');
    try{if(!merchantPending.has(cacheKey))merchantPending.set(cacheKey,marketplaceSearch(q,{page}).then(data=>{if(merchantCache.size>=100)merchantCache.clear();merchantCache.set(cacheKey,{data,at:Date.now()});return data}).finally(()=>merchantPending.delete(cacheKey)));const data=await merchantPending.get(cacheKey);return send(200,{...data,cached:false})}catch(e){console.warn('merchant_lookup_failed',JSON.stringify({name:e.name,message:e.message,code:e.cause?.code}));fail(502,'The merchant catalog is temporarily unavailable. No sample results were substituted. Please retry later.')}
   }
   if(resource==='listings'){seedCatalog(u);
    if(method==='GET')return send(200,list('listing',u.id).filter(p=>p.active));
    requireRole('provider','admin');
    if(method==='POST'||method==='PATCH'){const providers=list('provider',u.id).filter(p=>p.status==='approved');if(!providers.length)fail(403,'An approved provider is required.');const p=method==='PATCH'?get('listing',id,u.id):{id:randomUUID(),providerId:providers[0].id,provider:providers[0].name,area:providers[0].area,active:true};for(const k of ['name','species','description'])p[k]=str(body[k]??p[k],k,1000);p.type=pick(body.type??p.type,['Seeds','Seedlings'],'product type');for(const k of ['price','stock']){const v=body[k]??p[k];if(!Number.isInteger(v)||v<0||v>10000000)fail(400,`Invalid ${k}.`);p[k]=v}p.image=body.image||p.image||'sprout';audit(u,'Saved listing',p.name);return send(method==='POST'?201:200,save('listing',u.id,p))}
   }
   if(path==='/api/v1/payments/checkout'&&method==='POST')return send(201,await payments.checkout(u,body.items,req.headers['idempotency-key']));
   if(resource==='checkout'&&method==='POST'){
    if(!Array.isArray(body.items)||!body.items.length||body.items.length>30)fail(400,'Add products to your cart.');const key=str(req.headers['idempotency-key'],'Checkout request key',100),prior=db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(u.id,key);if(prior)return send(200,JSON.parse(prior.response));
    db.exec('BEGIN IMMEDIATE');try{let subtotal=0,provider;const seen=new Set();const items=body.items.map(i=>{if(seen.has(i.listingId))fail(400,'Duplicate cart item.');seen.add(i.listingId);const p=get('listing',i.listingId,u.id);if(!p.active)fail(409,'This product is unavailable.');if(!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99)fail(400,'Invalid quantity.');if(p.stock<i.quantity)fail(409,`${p.name} does not have enough stock.`);if(provider&&provider!==p.providerId)fail(400,'Use one provider per checkout.');provider=p.providerId;subtotal+=p.price*i.quantity;save('listing',u.id,{...p,stock:p.stock-i.quantity});return{listingId:p.id,name:p.name,quantity:i.quantity,price:p.price,image:p.image}});const order={id:randomUUID(),items,providerId:provider,subtotal,total:subtotal,fees:0,tax:0,status:'paid',paymentMode:'simulated',created:now(),pickup:'Demo pickup only — no real order was placed.'};save('order',u.id,order);db.prepare('INSERT INTO requests VALUES(?,?,?)').run(u.id,key,JSON.stringify(order));audit(u,'Demo order placed',order.id);db.exec('COMMIT');return send(201,order)}catch(e){db.exec('ROLLBACK');throw e}
   }
   if(resource==='orders'&&id&&method==='PATCH'){
    const o=get('order',id,u.id),next=body.status;const transitions={paid:['accepted','cancelled'],accepted:['ready','cancelled'],ready:['fulfilled','cancelled'],fulfilled:['refund_requested'],refund_requested:['refunded']};if(!(transitions[o.status]||[]).includes(next))fail(409,'This order status transition is not allowed.');if(['accepted','ready','fulfilled'].includes(next))requireRole('provider','admin');if(next==='refunded')requireRole('admin');db.exec('BEGIN IMMEDIATE');try{if(next==='cancelled'||next==='refunded')for(const i of o.items){const p=get('listing',i.listingId,u.id);save('listing',u.id,{...p,stock:p.stock+i.quantity})}o.status=next;save('order',u.id,o);audit(u,'Order '+next,o.id);db.exec('COMMIT');return send(200,o)}catch(e){db.exec('ROLLBACK');throw e}
   }
   if(resource==='providers'&&method==='POST'){return send(201,save('provider',u.id,{id:randomUUID(),name:str(body.name,'Provider name'),area:str(body.area,'Pickup area'),status:'pending',created:now()}))}
   if(resource==='admin'){
    requireRole('admin');const kind=parts[3],target=parts[4];
    if(kind==='providers'&&method==='PATCH'){const p=get('provider',target,u.id);p.status=pick(body.status,['approved','rejected'],'review decision');p.reason=body.status==='rejected'?str(body.reason,'Rejection reason'):'';save('provider',u.id,p);audit(u,'Provider '+p.status,p.name);return send(200,p)}
    if(kind==='listings'&&method==='DELETE'){const p=get('listing',target,u.id);p.active=false;save('listing',u.id,p);audit(u,'Listing removed',p.name+': '+str(body.reason||'Moderation review','Reason'));return send(200,p)}
   }
   fail(404,'Endpoint not found.');
  }catch(e){send(e.status||500,{error:e.status?e.message:'Something went wrong. Please retry.',requestId})}
 });
 server.on('close',()=>{stopping=true;care.stop();if(backups)void backups.stop().finally(()=>db.close());else db.close()});return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=createApp();app.listen(Number(process.env.PORT)||3001,'0.0.0.0',()=>console.log('Sproutly API listening'));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close());}

