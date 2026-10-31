import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';import {createApp} from './server.mjs';import {packetFieldKeys} from './packet-schema.mjs';
test('packet scans require consent, isolate owners, preserve provenance and require review',async()=>{
 let calls=0;const app=createApp({dbPath:':memory:',requiredMount:null,backupEnabled:false,packetExtractor:async()=>{calls++;return{imageQuality:'usable',summary:'Test result',fields:packetFieldKeys.map(key=>({key,value:key==='commonName'?'Basil':null,confidence:key==='commonName'?'needs_confirmation':'not_detected',evidence:key==='commonName'?'Basil':'',imageIndex:key==='commonName'?0:null})),ocr:[{text:'Basil',blocks:[]}],warnings:[]}}});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}/api/v1`;
 const call=async(path,method='GET',body,token,key)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
 try{
  const a=(await call('/auth/demo','POST',{})).data.token,b=(await call('/auth/demo','POST',{})).data.token;
  const image='data:image/png;base64,'+(await sharp({create:{width:800,height:1000,channels:3,background:'white'}}).png().toBuffer()).toString('base64');
  const media=(await call('/media','POST',{data:image},a)).data.id;
  assert.equal((await call('/packet-media/prepare','POST',{mediaId:media,rotation:90},b)).status,404);
  const prepared=await call('/packet-media/prepare','POST',{mediaId:media,rotation:90},a);assert.equal(prepared.status,201);assert.equal(prepared.data.originalMediaId,media);
  const input={photos:[{mediaId:prepared.data.id,side:'front'}],consent:true};
  assert.equal((await call('/packet-extractions','POST',{...input,consent:false},a,'scan-a')).status,400);
  assert.equal((await call('/packet-extractions','POST',input,b,'scan-a')).status,404);
  let job=await call('/packet-extractions','POST',input,a,'scan-a');assert.equal(job.status,202);const id=job.data.id;
  for(let i=0;i<20&&['queued','running'].includes(job.data.status);i++){await new Promise(r=>setTimeout(r,5));job=await call('/packet-extractions/'+id,'GET',null,a)}assert.equal(job.data.status,'completed');
  assert.equal((await call('/packet-extractions','POST',input,a,'scan-a')).data.id,id);assert.equal(calls,1);
  assert.equal((await call('/packet-extractions/'+id,'GET',null,b)).status,404);
  assert.equal((await call('/seed-packets','POST',{name:'Basil',extractionId:id},a)).status,409);
  assert.equal((await call('/packet-extractions/'+id+'/confirm','POST',{values:{commonName:'Basil'}},a)).status,400);
  assert.equal((await call('/packet-extractions/'+id+'/confirm','POST',{confirmed:true,values:{}},a)).status,400);
  assert.equal((await call('/packet-extractions/'+id+'/confirm','POST',{confirmed:true,values:{commonName:'Basil',plantingDepth:'2 furlongs'}},a)).status,400);
  const values={commonName:'Sweet basil',plantingDepth:'1/4 inch'};const confirmed=await call('/packet-extractions/'+id+'/confirm','POST',{confirmed:true,values},a);assert.equal(confirmed.status,200);
  assert.equal((await call('/packet-extractions/'+id+'/confirm','POST',{confirmed:true,values:{commonName:'Changed'}},a)).status,409);
  const saved=await call('/seed-projects/from-packet','POST',{packet:{name:'Sweet basil',extractionId:id,mediaIds:[prepared.data.id]},project:{name:'Kitchen basil'}},a,'create-reviewed');assert.equal(saved.status,201);assert.equal(saved.data.packet.confirmedFields.commonName,'Sweet basil');assert.equal(saved.data.packet.extractedFields[0].value,'Basil');assert.equal(saved.data.packet.originalMediaIds[0],media);
  assert.equal((await call('/seed-packets','POST',{name:'Foreign',extractionId:id},b)).status,404);
  assert.equal((await call('/packet-extractions/'+id)).status,401);
 }finally{await new Promise(r=>app.close(r))}
});
