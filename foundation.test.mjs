import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFoundation} from './foundation.mjs';
function setup(path=':memory:'){
 const db=new DatabaseSync(path);db.exec("PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY);INSERT OR IGNORE INTO users VALUES('a'),('b');");
 const api=createFoundation(db,{ownedRecord:(kind,id,owner)=>{if(owner!=='a'||!['plant-a','photo-a'].includes(id)||((kind==='plant')!==(id==='plant-a')))throw Object.assign(new Error('Record not found.'),{status:404})}});
 return {db,api};
}
test('seed records and linked histories persist after reopening',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sproutly-foundation-'));const path=join(dir,'test.sqlite');let {db,api}=setup(path);
 try{
  const packet=api.write('a','seed-packets',{name:'Basil',mediaIds:['photo-a'],sources:[{type:'packet',label:'Back panel'}]});
  const project=api.write('a','seed-projects',{name:'Kitchen basil',packetId:packet.id,growingMethod:'indoor',sowingDate:'2026-10-31'});
  const plan=api.write('a','grow-plans',{title:'Basil plan',projectId:project.id,instructions:'Review packet before sowing.'});
  api.write('a','grow-plans',{instructions:'Confirmed packet instructions.'},plan.id,1);
  const conversation=api.write('a','conversations',{title:'Basil questions',projectId:project.id});api.append('a',conversation.id,{text:'When should I sow?',mediaIds:['photo-a']});
  const rescue=api.write('a','rescue-plans',{title:'Recovery',plantId:'plant-a',objective:'Observe new growth.'});
  db.close();({db,api}=setup(path));
  assert.equal(api.read('a','seed-projects',project.id).packetId,packet.id);
  assert.equal(api.versions('a','grow-plans',plan.id).length,2);
  assert.equal(api.messages('a',conversation.id)[0].role,'user');
  assert.equal(api.read('a','rescue-plans',rescue.id).plantId,'plant-a');
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
test('all read, write, history and linked-reference operations isolate owners',()=>{
 const {db,api}=setup();try{
  const packet=api.write('a','seed-packets',{name:'Basil'}),project=api.write('a','seed-projects',{name:'Basil',packetId:packet.id});
  const conversation=api.write('a','conversations',{title:'Questions',projectId:project.id});
  for(const action of [()=>api.read('b','seed-projects',project.id),()=>api.write('b','seed-projects',{name:'Stolen'},project.id,1),()=>api.versions('b','seed-projects',project.id),()=>api.messages('b',conversation.id),()=>api.append('b',conversation.id,{text:'Intrusion'}),()=>api.write('b','seed-projects',{name:'Other',packetId:packet.id}),()=>api.write('b','rescue-plans',{title:'Other',plantId:'plant-a'}),()=>api.write('b','seed-packets',{name:'Other',mediaIds:['photo-a']})])assert.throws(action,{status:404});
  assert.deepEqual(api.list('b','seed-projects'),[]);
 }finally{db.close()}
});
test('validation, immutable links and optimistic locking prevent corrupt history',()=>{
 const {db,api}=setup();try{
  const project=api.write('a','seed-projects',{name:'Basil'});
  assert.throws(()=>api.write('a','seed-projects',{stage:'made-up'},project.id,1),{status:400});
  assert.throws(()=>api.write('a','seed-projects',{sowingDate:'2026-02-30'},project.id,1),{status:400});
  assert.throws(()=>api.write('a','seed-projects',{plantId:'plant-a'},project.id,1),{status:400});
  assert.throws(()=>api.write('a','seed-projects',{owner:'b'},project.id,1),{status:400});
  api.write('a','seed-projects',{stage:'sown'},project.id,1);
  assert.throws(()=>api.write('a','seed-projects',{stage:'completed'},project.id,1),{status:409});
  assert.equal(api.versions('a','seed-projects',project.id).length,2);
  const c=api.write('a','conversations',{title:'Questions',projectId:project.id});
  assert.throws(()=>api.append('a',c.id,{text:'Forged',role:'assistant'}),{status:400});
  assert.throws(()=>api.write('a','seed-packets',{name:'Basil',sources:[{type:'reference',label:'Unsafe',url:'javascript:alert(1)'}]}),{status:400});
 }finally{db.close()}
});
