import {S3Client,PutObjectCommand,GetObjectCommand,GetPublicAccessBlockCommand} from '@aws-sdk/client-s3';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {createReadStream,createWriteStream} from 'node:fs';import {pipeline} from 'node:stream/promises';import {createHash} from 'node:crypto';import {join,dirname,basename} from 'node:path';
import {verifyBackup} from './backup.mjs';
export function createOffsite({bucket=process.env.BACKUP_S3_BUCKET,account=process.env.BACKUP_S3_ACCOUNT_ID,region=process.env.AWS_REGION,client}={}){
 const status={enabled:!!bucket,lastSuccessAt:null,lastFailureAt:null};if(!bucket)return{status,upload:async()=>{}};
 if(!/^[0-9]{12}$/.test(account||'')||!region)throw new Error('Off-site backup requires AWS_REGION and the expected BACKUP_S3_ACCOUNT_ID.');
 const s3=client||new S3Client({region,maxAttempts:3});const common={Bucket:bucket,ExpectedBucketOwner:account};
 return{status,async upload(snapshot){let temporary;try{
  await verifyBackup(snapshot.path);
  const access=await s3.send(new GetPublicAccessBlockCommand(common));const b=access.PublicAccessBlockConfiguration;if(!b||![b.BlockPublicAcls,b.IgnorePublicAcls,b.BlockPublicPolicy,b.RestrictPublicBuckets].every(Boolean))throw new Error('The backup bucket must block all public access.');
  const prefix='sproutly/backups/',key=prefix+basename(snapshot.path),manifest=await readFile(snapshot.path+'.json');
  await s3.send(new PutObjectCommand({...common,Key:key,Body:createReadStream(snapshot.path),ServerSideEncryption:'AES256',ChecksumSHA256:Buffer.from(snapshot.sha256,'hex').toString('base64'),ContentType:'application/vnd.sqlite3'}));
  await s3.send(new PutObjectCommand({...common,Key:key+'.json',Body:manifest,ServerSideEncryption:'AES256',ContentType:'application/json'}));
  temporary=await mkdtemp(join(dirname(snapshot.path),'offsite-verify-'));const remote=join(temporary,basename(snapshot.path));
  const response=await s3.send(new GetObjectCommand({...common,Key:key}));if(!response.Body)throw new Error('Remote backup is empty.');await pipeline(response.Body,createWriteStream(remote,{mode:0o600}));
  const metadata=await s3.send(new GetObjectCommand({...common,Key:key+'.json'}));await writeFile(remote+'.json',await metadata.Body.transformToByteArray(),{mode:0o600});await verifyBackup(remote);
  status.lastSuccessAt=new Date().toISOString();status.lastFailureAt=null;
 }catch{status.lastFailureAt=new Date().toISOString();throw new Error('Off-site backup upload or read-back verification failed. Local snapshots are retained.')}finally{if(temporary)await rm(temporary,{recursive:true,force:true})}}};
}
