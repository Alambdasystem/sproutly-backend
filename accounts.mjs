import {randomBytes,createHash,scryptSync} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const error=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function configuredMail(){return !!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM&&process.env.PUBLIC_APP_URL)}
export async function sendMail({to,subject,text}){
 if(!configuredMail())throw new Error('Email delivery is not configured.');
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[to],subject,text}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('Email provider did not accept delivery.');
 return {accepted:true};
}
export function createAccounts(db,{mail=sendMail,mailConfigured=configuredMail,appUrl=process.env.PUBLIC_APP_URL||'https://sproutly-frontend.onrender.com',clock=Date.now}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS account_security(user_id TEXT PRIMARY KEY,email_verified INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS account_tokens(digest TEXT PRIMARY KEY,user_id TEXT NOT NULL,purpose TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);`);
 const verified=id=>!!db.prepare('SELECT email_verified FROM account_security WHERE user_id=?').get(id)?.email_verified;
 async function issue(u,purpose){
  if(!mailConfigured())return 'not_configured';
  if(db.prepare('SELECT digest FROM account_tokens WHERE user_id=? AND purpose=? AND expires>?').get(u.id,purpose,clock()+29*60000))return 'rate_limited';
  const token=randomBytes(32).toString('hex'),digest=hash(token),expires=clock()+30*60000;
  db.prepare('UPDATE account_tokens SET used=1 WHERE user_id=? AND purpose=?').run(u.id,purpose);
  db.prepare('INSERT INTO account_tokens VALUES(?,?,?,?,0)').run(digest,u.id,purpose,expires);
  const url=new URL(appUrl);if(url.protocol!=='https:')throw new Error('PUBLIC_APP_URL must use HTTPS.');url.hash=purpose+'='+token;
  try{await mail({to:u.email,subject:purpose==='reset'?'Reset your Sproutly password':'Verify your Sproutly email',text:`${purpose==='reset'?'Choose a new password':'Confirm your email address'} using this private link:\n\n${url.href}\n\nThis link expires in 30 minutes and works once. If you did not request it, ignore this message.`});return 'submitted'}catch{db.prepare('DELETE FROM account_tokens WHERE digest=?').run(digest);return 'failed'}
 }
 function consume(token,purpose){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))error(400,'This link is invalid or expired.');const t=db.prepare('SELECT * FROM account_tokens WHERE digest=? AND purpose=? AND used=0 AND expires>?').get(hash(token),purpose,clock());if(!t)error(400,'This link is invalid or expired.');return t}
 return {verified,issue,configured:mailConfigured,async route(path,body,u){
  if(path==='/api/v1/auth/reset'){
   if(!mailConfigured())error(503,'Password reset email is not configured yet.');
   if(typeof body.email!=='string'||body.email.length>254)error(400,'Enter your email address.');
   const account=db.prepare('SELECT * FROM users WHERE email=? AND demo=0').get(body.email.trim().toLowerCase());if(account)await issue(account,'reset');
   return {message:'If an account exists, password reset instructions will arrive by email.'};
  }
  if(path==='/api/v1/auth/reset-confirm'){
   if(typeof body.password!=='string'||body.password.length<10||body.password.length>200)error(400,'Use a password between 10 and 200 characters.');
   const t=consume(body.token,'reset'),salt=randomBytes(16).toString('hex'),password=salt+':'+scryptSync(body.password,salt,64).toString('hex');
   db.exec('BEGIN IMMEDIATE');try{const changed=db.prepare('UPDATE account_tokens SET used=1 WHERE digest=? AND used=0').run(t.digest);if(!changed.changes)error(400,'This link was already used.');db.prepare('UPDATE users SET password=? WHERE id=?').run(password,t.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.user_id);db.prepare("UPDATE account_tokens SET used=1 WHERE user_id=? AND purpose='reset'").run(t.user_id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
   return {message:'Password updated. Sign in with your new password.'};
  }
  if(path==='/api/v1/auth/verify'){
   const t=consume(body.token,'verify');db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE account_tokens SET used=1 WHERE digest=?').run(t.digest);db.prepare('INSERT OR REPLACE INTO account_security VALUES(?,1)').run(t.user_id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return {message:'Email verified.'};
  }
  if(path==='/api/v1/auth/verification'){
   if(!u)error(401,'Please sign in.');if(u.demo)error(400,'Create an account to verify an email address.');if(!mailConfigured())error(503,'Verification email is not configured yet.');if(verified(u.id))return {message:'Your email is already verified.'};const delivery=await issue(u,'verify');if(delivery==='rate_limited')error(429,'Please wait a minute before requesting another email.');if(delivery!=='submitted')error(503,'Email could not be sent. Please retry.');return {message:'Verification email sent.'};
  }
  return null;
 }};
}
