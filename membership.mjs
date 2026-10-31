import {timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function entitlementState(subscriber,{now=Date.now(),allowSandbox=false}={}){
 const item=subscriber?.entitlements?.premium;if(!item||typeof item.product_identifier!=='string'||!item.product_identifier)return{premium:false,status:'free',expires:null};const expiry=item.expires_date?Date.parse(item.expires_date):null;
 const subscription=subscriber.subscriptions?.[item.product_identifier];if(subscription?.is_sandbox&&!allowSandbox)return{premium:false,status:'sandbox-not-enabled',expires:item.expires_date||null};
 if(subscription?.refunded_at||item.expires_date&&(!Number.isFinite(expiry)||expiry<=now))return{premium:false,status:subscription?.refunded_at?'refunded':'expired',expires:item.expires_date||null};
 return{premium:true,status:subscription?.unsubscribe_detected_at?'cancelled-active-until-expiry':'active',expires:item.expires_date||null,product:item.product_identifier||null};
}
export function createMembership(db,{key=process.env.REVENUECAT_SECRET_KEY,enforced=process.env.PREMIUM_ENFORCEMENT==='true',webhookToken=process.env.REVENUECAT_WEBHOOK_TOKEN,allowSandbox=process.env.REVENUECAT_ALLOW_SANDBOX==='true',fetchImpl=fetch}={}){
 const cache=new Map();db.exec('CREATE TABLE IF NOT EXISTS membership_events(id TEXT PRIMARY KEY,created TEXT NOT NULL);');
 async function status(owner,refresh=false){
  if(!key)return{mode:enforced?'configuration-required':'pilot',configured:false,enforced,premium:false,status:'not-configured',expires:null,accessNotice:enforced?'Subscription access is not configured.':'Pilot features are available without a subscription. No payment or trial has started.'};
  const cached=cache.get(owner);if(cached&&!refresh&&Date.now()-cached.at<60000)return cached.data;
  let response;try{response=await fetchImpl('https://api.revenuecat.com/v1/subscribers/'+encodeURIComponent(owner),{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(12000)})}catch{fail(503,'Subscription verification is temporarily unavailable.');}if(!response.ok)fail(503,'Subscription verification is temporarily unavailable.');const body=await response.json();const data={mode:enforced?'subscriptions':'pilot',configured:true,enforced,...entitlementState(body.subscriber,{allowSandbox}),managementUrl:typeof body.subscriber?.management_url==='string'&&body.subscriber.management_url.startsWith('https://')?body.subscriber.management_url:null};cache.set(owner,{at:Date.now(),data});return data;
 }
 async function access(owner,feature){if(!enforced)return;const current=await status(owner);if(!current.configured)fail(503,'Subscription setup is required before Premium access can be enforced.');if(current.premium)return;
  const month=new Date().toISOString().slice(0,7),week=new Date();week.setUTCDate(week.getUTCDate()-(week.getUTCDay()+6)%7);week.setUTCHours(0,0,0,0);
  const count=(kind,predicate=()=>true)=>db.prepare('SELECT body FROM records WHERE kind=? AND owner=?').all(kind,owner).map(r=>JSON.parse(r.body)).filter(predicate).length;
  if(feature==='plant'&&count('plant')<3)return;
  if(feature==='identify'&&count('assessment',a=>a.purpose==='identify'&&a.created>=week.toISOString()&&a.status==='completed')<3)return;
  if(feature==='diagnose'&&count('assessment',a=>a.purpose!=='identify'&&a.created.startsWith(month)&&a.status==='completed')<1)return;
  if(feature==='question'&&count('care_job',j=>j.type==='doctor'&&j.created.startsWith(month)&&j.status==='completed')<3)return;
  if(feature==='rescue'&&count('rescue_plan')<1)return;
  fail(402,'This feature or free usage allowance requires Premium. Basic garden records remain available.');
 }
 return{status,access,forget:owner=>cache.delete(owner),async webhook(body,authorization){if(!webhookToken)fail(503,'Subscription webhooks are not configured.');const provided=Buffer.from(authorization||''),expected=Buffer.from('Bearer '+webhookToken);if(provided.length!==expected.length||!timingSafeEqual(provided,expected))fail(401,'Invalid subscription webhook authentication.');const event=body?.event;if(!event||typeof event.id!=='string'||typeof event.app_user_id!=='string')fail(400,'Invalid subscription event.');if(db.prepare('SELECT id FROM membership_events WHERE id=?').get(event.id))return{received:true,replayed:true};cache.delete(event.app_user_id);db.prepare('INSERT INTO membership_events VALUES(?,?)').run(event.id,new Date().toISOString());return{received:true}}};
}
