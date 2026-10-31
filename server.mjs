import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const str=(v,name,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,`${name} is required (maximum ${max} characters).`);return v.trim()};
const pick=(v,values,name)=>{if(!values.includes(v))fail(400,`Invalid ${name}.`);return v};
const now=()=>new Date().toISOString();
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,demo:!!u.demo});
export function createApp({dbPath=process.env.DATABASE_PATH||'data/sproutly.sqlite',origins=(process.env.CORS_ORIGINS||'http://localhost:8081,http://localhost:19006').split(',')}={}){
 if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
 const db=new DatabaseSync(dbPath); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,demo INTEGER,created TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT,owner TEXT,body TEXT);
 CREATE INDEX IF NOT EXISTS records_owner ON records(kind,owner);
 CREATE TABLE IF NOT EXISTS requests(owner TEXT,key TEXT,response TEXT,PRIMARY KEY(owner,key));`);
 const list=(kind,owner)=>db.prepare('SELECT * FROM records WHERE kind=? AND owner=?').all(kind,owner).map(r=>JSON.parse(r.body));
 const get=(kind,id,owner)=>{const r=db.prepare('SELECT * FROM records WHERE kind=? AND id=? AND owner=?').get(kind,id,owner);if(!r)fail(404,'Record not found.');return JSON.parse(r.body)};
 const save=(kind,owner,data)=>{db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)').run(data.id,kind,owner,JSON.stringify(data));return data};
 const audit=(u,action,target)=>save('audit',u.id,{id:randomUUID(),action,target,actor:u.name,at:now()});
 function seed(u){
  const date=now();
  const plants=[{id:randomUUID(),name:'Sweet basil',species:'Ocimum basilicum',stage:'Seedling',location:'Kitchen windowsill',status:'Not assessed',image:'basil',created:date},{id:randomUUID(),name:'Monstera',species:'Monstera deliciosa',stage:'Established',location:'Living room',status:'Not assessed',image:'monstera',created:date},{id:randomUUID(),name:'Little beginnings',species:'Cherry tomato',stage:'Sprout',location:'Patio',status:'Not assessed',image:'sprout',created:date}];
  plants.forEach(p=>{save('plant',u.id,p);save('journal',u.id,{id:randomUUID(),plantId:p.id,type:'Milestone',note:`Added ${p.name} to my garden.`,created:date});});
  plants.slice(0,2).forEach(p=>save('task',u.id,{id:randomUUID(),plantId:p.id,title:`Check soil for ${p.name}`,due:date,done:false}));
  save('provider',u.id,{id:'local-growers-'+u.id,name:'Root & Rise Nursery',area:'St. Louis, MO',status:'approved',pickup:'Sample pickup location — arrange after ordering',created:date});
  [{name:'Genovese basil',species:'Ocimum basilicum',type:'Seedlings',price:600,stock:24,image:'basil',description:'A fragrant kitchen companion. A pack of four young basil plants.'},{name:'Monstera cutting',species:'Monstera deliciosa',type:'Seedlings',price:1200,stock:8,image:'monstera',description:'A rooted cutting, ready for its next growing chapter.'},{name:'Cherry tomato seeds',species:'Solanum lycopersicum',type:'Seeds',price:450,stock:40,image:'sprout',description:'A packet of twenty seeds for your next sunny-season garden.'}].forEach(p=>save('listing',u.id,{...p,id:randomUUID(),providerId:'local-growers-'+u.id,provider:'Root & Rise Nursery',area:'St. Louis, MO',active:true}));
  save('provider',u.id,{id:randomUUID(),name:'Seed & Stem Collective',area:'St. Louis, MO',status:'pending',created:date});
 }
 function session(u){const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,Date.now()+7*864e5);return{token,user:publicUser(u)}}
 const rate=new Map();
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(origin&&origins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
  res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,Idempotency-Key');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
   if(path==='/health')return send(200,{status:'ok',service:'sproutly-backend',mode:'demo-data'});
   let body={};if(['POST','PATCH','DELETE'].includes(method)){let chunks=[],length=0;for await(const chunk of req){length+=chunk.length;if(length>5_500_000)fail(413,'Request too large.');chunks.push(chunk)}try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{fail(400,'Invalid JSON.')}}
   if(path.startsWith('/api/v1/auth/')&&method==='POST'){
    const ip=req.socket.remoteAddress;const r=rate.get(ip)||{count:0,until:Date.now()+60000};if(r.until<Date.now()){r.count=0;r.until=Date.now()+60000}if(++r.count>40)fail(429,'Please wait before trying again.');rate.set(ip,r);
    if(path.endsWith('/demo')){if(process.env.DEMO_ENABLED==='false')fail(404,'Demo is disabled.');const u={id:randomUUID(),name:'Garden explorer',email:`demo-${randomUUID()}@example.invalid`,password:'',role:'admin',demo:1,created:now()};db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(u.id,u.name,u.email,u.password,u.role,1,u.created);seed(u);return send(201,session(u))}
    if(path.endsWith('/register')){const email=str(body.email,'Email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Enter a valid email.');const pw=str(body.password,'Password',200);if(pw.length<10)fail(400,'Use at least 10 characters for your password.');if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail(409,'This email is already registered.');const salt=randomBytes(16).toString('hex');const u={id:randomUUID(),name:str(body.name,'Name',80),email,password:salt+':'+scryptSync(pw,salt,64).toString('hex'),role:'grower',demo:0,created:now()};db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(u.id,u.name,u.email,u.password,u.role,0,u.created);return send(201,{...session(u),emailDelivery:'not_configured'})}
    if(path.endsWith('/login')){const email=str(body.email,'Email').toLowerCase(),pw=str(body.password,'Password');const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u?.password)fail(401,'Email or password is incorrect.');const[salt,hash]=u.password.split(':');if(!timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(pw,salt,64)))fail(401,'Email or password is incorrect.');return send(200,session(u))}
    if(path.endsWith('/reset'))return send(200,{message:'Password reset delivery is not connected in this demo. No email was sent.',simulated:true});
   }
   const token=(req.headers.authorization||'').replace(/^Bearer /,'');const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,Date.now());if(!s)fail(401,'Please sign in.');const u=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
   const requireRole=(...roles)=>{if(!roles.includes(u.role))fail(403,'Your account does not have permission for this action.')};
   if(path==='/api/v1/auth/logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);return send(200,{ok:true})}
   if(path==='/api/v1/me'&&method==='GET')return send(200,publicUser(u));
   if(path==='/api/v1/bootstrap'&&method==='GET')return send(200,{user:publicUser(u),plants:list('plant',u.id),tasks:list('task',u.id),journal:list('journal',u.id),stories:list('story',u.id),assessments:list('assessment',u.id),listings:list('listing',u.id).filter(p=>p.active),orders:list('order',u.id),providers:list('provider',u.id),audit:u.role==='admin'?list('audit',u.id):[],mode:'seeded-demo',integrations:{assessments:'simulated',payments:'simulated',email:'not-configured'}});
   const parts=path.split('/').filter(Boolean),resource=parts[2],id=parts[3];
   if(resource==='plants'){
    if(method==='GET')return send(200,id?get('plant',id,u.id):list('plant',u.id));
    if(method==='POST'){if(body.mediaId)get('media',body.mediaId,u.id);const p=save('plant',u.id,{id:randomUUID(),name:str(body.name,'Plant name',80),species:str(body.species||'Unknown','Species',120),stage:pick(body.stage||'Seed','Seed Germination Sprout Seedling Established Harvest Dormancy'.split(' '),'stage'),location:str(body.location||'Not specified','Location'),image:body.mediaId?'media':body.image||'sprout',mediaId:body.mediaId||null,status:'Not assessed',created:now()});if(p.mediaId)get('media',p.mediaId,u.id);save('journal',u.id,{id:randomUUID(),plantId:p.id,type:'Milestone',note:`Added ${p.name} to my garden.`,created:now()});return send(201,p)}
    if(method==='PATCH'){const p=get('plant',id,u.id);for(const key of ['name','species','location'])if(body[key]!==undefined)p[key]=str(body[key],key);if(body.stage)p.stage=pick(body.stage,['Seed','Germination','Sprout','Seedling','Established','Harvest','Dormancy'],'stage');return send(200,save('plant',u.id,p))}
    if(method==='DELETE'){get('plant',id,u.id);for(const kind of ['journal','task','assessment','story'])for(const r of list(kind,u.id))if(r.plantId===id)db.prepare('DELETE FROM records WHERE id=? AND owner=?').run(r.id,u.id);db.prepare('DELETE FROM records WHERE id=? AND owner=?').run(id,u.id);return send(200,{ok:true})}
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
    if(method==='POST'){const plant=get('plant',body.plantId,u.id);if(body.mediaId)get('media',body.mediaId,u.id);const a={id:randomUUID(),plantId:plant.id,status:'completed',simulated:true,mediaId:body.mediaId||null,observations:str(body.symptoms,'Observed symptoms',1200),context:{watering:body.watering||'Unknown',light:body.light||'Unknown'},uncertainty:'Illustrative result — image not analyzed',causes:[{name:'Possible watering stress',evidence:'Sample explanation only. This result is not based on an analysis of your photograph.'},{name:'Possible light stress',evidence:'More growing context and a real assessment service are needed.'}],actions:['Check soil moisture before changing watering.','Record light conditions and recent care changes.','Compare new observations at your next check.'],created:now()};save('assessment',u.id,a);save('journal',u.id,{id:randomUUID(),plantId:plant.id,type:'Assessment',note:'Saved a simulated plant assessment.',created:a.created});return send(201,a)}
   }
   if(resource==='stories'){
    if(method==='POST'){const p=get('plant',body.plantId,u.id),entries=list('journal',u.id).filter(e=>e.plantId===p.id);const text=entries.map(e=>`${new Date(e.created).toLocaleDateString('en-US',{timeZone:'UTC'})}: ${e.note}`).join('\n');return send(201,save('story',u.id,{id:randomUUID(),plantId:p.id,title:`${p.name}'s growing story`,text:text||'Your growing story starts with your first journal entry.',privacy:'private',generated:true,created:now()}))}
    if(method==='PATCH'){const s=get('story',id,u.id);s.text=str(body.text,'Story',10000);return send(200,save('story',u.id,s))}
   }
   if(resource==='listings'){
    if(method==='GET')return send(200,list('listing',u.id).filter(p=>p.active));
    requireRole('provider','admin');
    if(method==='POST'||method==='PATCH'){const providers=list('provider',u.id).filter(p=>p.status==='approved');if(!providers.length)fail(403,'An approved provider is required.');const p=method==='PATCH'?get('listing',id,u.id):{id:randomUUID(),providerId:providers[0].id,provider:providers[0].name,area:providers[0].area,active:true};for(const k of ['name','species','description'])p[k]=str(body[k]??p[k],k,1000);p.type=pick(body.type??p.type,['Seeds','Seedlings'],'product type');for(const k of ['price','stock']){const v=body[k]??p[k];if(!Number.isInteger(v)||v<0||v>10000000)fail(400,`Invalid ${k}.`);p[k]=v}p.image=body.image||p.image||'sprout';audit(u,'Saved listing',p.name);return send(method==='POST'?201:200,save('listing',u.id,p))}
   }
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
  }catch(e){send(e.status||500,{error:e.status?e.message:'Something went wrong. Please retry.',requestId:randomUUID()})}
 });
 server.on('close',()=>db.close());return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=createApp();app.listen(Number(process.env.PORT)||3001,'0.0.0.0',()=>console.log('Sproutly API listening'));}
