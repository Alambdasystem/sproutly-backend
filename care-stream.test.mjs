import test from 'node:test';import assert from 'node:assert/strict';
import {summaryPreview,readCareStream} from './care-stream.mjs';import {runCareAI} from './care-ai.mjs';import {createApp} from './server.mjs';
const result={summary:'Check the soil. 🌱',objective:'Inspect',observations:'No photo',possibleCauses:[],assumptions:[],warnings:['Avoid standing water.'],questions:['Does the pot drain?'],steps:[],proposals:[],progress:'insufficient_evidence'};
const frame=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
test('summary previews decode chunked JSON escapes without leaking proposals or other fields',()=>{
 const json=JSON.stringify(result);for(let n=0;n<=json.length;n++){const p=summaryPreview(json.slice(0,n));assert.ok(result.summary.startsWith(p));assert.ok(!/[\uD800-\uDBFF]$/.test(p))}
 assert.equal(summaryPreview('{"summary":"a\\n\\"b\\u0021","proposals":['),'a\n"b!');assert.equal(summaryPreview('{"objective":"secret"}'),'');assert.equal(summaryPreview('{"summary":"a\\x"}'),'');
});
test('Responses SSE handles byte boundaries, requires completion and validates final guidance before saving',async()=>{
 const previews=[];let sent;
 const wire=frame({type:'response.output_text.delta',delta:JSON.stringify(result)})+frame({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}],usage:{input_tokens:4,output_tokens:8}}});
 const bytes=new TextEncoder().encode(wire);
 const response=()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close()}}));
 const answer=await runCareAI({type:'plant_doctor_conversation',context:{},onPreview:t=>previews.push(t)},{key:'test',fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return response()}});
 assert.equal(sent.stream,true);assert.equal(sent.store,false);assert.equal(answer.summary,result.summary);assert.deepEqual(previews,[result.summary]);assert.equal(answer.usage.outputTokens,8);
 await assert.rejects(()=>readCareStream(new Response(frame({type:'response.output_text.delta',delta:'{"summary":"unfinished'})),()=>{}),/incomplete/);
 await assert.rejects(()=>readCareStream(new Response(frame({type:'response.refusal.delta',delta:'No'})),()=>{}),/could not complete/);
});
test('authenticated job events stream previews and terminal saved results without rerunning AI or crossing accounts',async()=>{
 let finish,calls=0;const app=createApp({dbPath:':memory:',requiredMount:null,backupEnabled:false,careAI:async request=>{calls++;request.onPreview('Check the soil.');return new Promise(r=>finish=()=>r(result))}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}/api/v1`;
 const call=async(path,method='GET',body,token,key)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()}};
 try{const a=(await call('/auth/demo','POST',{})).data,b=(await call('/auth/demo','POST',{})).data;const plant=(await call('/bootstrap','GET',null,a.token)).data.plants[0];const c=(await call('/care/conversations','POST',{plantId:plant.id},a.token)).data;
  const job=(await call(`/care/conversations/${c.id}/messages`,'POST',{text:'Check basil',consent:true},a.token,'stream-one')).data;
  const path=`/care/jobs/${job.id}/events`;assert.equal((await call(path)).status,401);assert.equal((await call(path,'GET',null,b.token)).status,404);
  const response=await fetch(base+path,{headers:{Authorization:'Bearer '+a.token}});assert.match(response.headers.get('content-type'),/event-stream/);const reader=response.body.getReader(),decode=new TextDecoder();let wire=decode.decode((await reader.read()).value);assert.match(wire,/Check the soil/);assert.doesNotMatch(wire,/proposals/);
  finish();while(!wire.includes('completed')){const chunk=await reader.read();if(chunk.done)break;wire+=decode.decode(chunk.value)}assert.match(wire,/completed/);await reader.cancel();
  const history=(await call('/care/conversations/'+c.id,'GET',null,a.token)).data.messages;assert.equal(history.length,2);assert.equal(history[1].text,result.summary);assert.equal(calls,1);
  const replay=await call(`/care/conversations/${c.id}/messages`,'POST',{text:'Check basil',consent:true},a.token,'stream-one');assert.equal(replay.data.id,job.id);assert.equal(calls,1);
 }finally{finish?.();app.closeAllConnections();await new Promise(r=>app.close(r))}
});
