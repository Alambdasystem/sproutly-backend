import test from 'node:test';import assert from 'node:assert/strict';import {createApp} from './server.mjs';
test('authenticated foundation API roundtrip and ownership checks',async()=>{
 const app=createApp({dbPath:':memory:',requiredMount:null,backupEnabled:false});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${app.address().port}/api/v1`;
 const call=async(path,method='GET',body,token)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
 try{
  assert.equal((await call('/seed-projects')).status,401);
  const a=(await call('/auth/demo','POST',{})).data,b=(await call('/auth/demo','POST',{})).data;
  const atomicBody={packet:{name:'Atomic packet'},project:{name:'Atomic project'}};
  const atomicRequest=()=>fetch(base+'/seed-projects/from-packet',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${a.token}`,'Idempotency-Key':'http-draft'},body:JSON.stringify(atomicBody)}).then(async r=>({status:r.status,data:await r.json()}));
  const atomic=await atomicRequest();assert.equal(atomic.status,201);assert.deepEqual((await atomicRequest()).data,atomic.data);
  const packet=await call('/seed-packets','POST',{name:'Basil'},a.token);assert.equal(packet.status,201);
  const project=await call('/seed-projects','POST',{name:'Windowsill basil',packetId:packet.data.id},a.token);assert.equal(project.status,201);
  assert.equal((await call('/seed-projects/'+project.data.id,'GET',null,b.token)).status,404);
  assert.equal((await call('/seed-projects/'+project.data.id,'PATCH',{revision:1,stage:'sown'},a.token)).status,200);
  assert.equal((await call('/seed-projects/'+project.data.id,'PATCH',{revision:1,stage:'completed'},a.token)).status,409);
  assert.equal((await call('/seed-projects/'+project.data.id+'/versions','GET',null,a.token)).data.length,2);
  const c=await call('/conversations','POST',{title:'Seed questions',projectId:project.data.id},a.token);
  assert.equal((await call('/conversations/'+c.data.id+'/messages','POST',{text:'What comes next?'},a.token)).status,201);
  assert.equal((await call('/conversations/'+c.data.id+'/messages','GET',null,a.token)).data.length,1);
  assert.equal((await call('/conversations/'+c.data.id+'/messages','GET',null,b.token)).status,404);
  const boot=(await call('/bootstrap','GET',null,a.token)).data;
  const rescue=await call('/rescue-plans','POST',{title:'Recovery',plantId:boot.plants[0].id},a.token);assert.equal(rescue.status,201);
  assert.equal((await call('/plants/'+boot.plants[0].id,'DELETE',{},a.token)).status,409);
  assert.equal((await call('/bootstrap','GET',null,a.token)).data.plants.length,3);
 }finally{await new Promise(r=>app.close(r))}
});
