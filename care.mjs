import {randomUUID,createHash} from 'node:crypto';
import {runCareAI} from './care-ai.mjs';
import {validateSetup,buildSeedPlan,germinationWindow,addDays,isoDate} from './growing.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const str=(v,name,max=3000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,`Enter ${name} (up to ${max} characters).`);return v.trim()};
const stamp=()=>new Date().toISOString();
export function createCare({db,foundation,get,list,save,ai=runCareAI,access=async()=>{},busy=()=>false}){
 let active=0,closed=false;
 const own=(kind,id,owner)=>get(kind,str(id,'record ID',150),owner);
 const rows=(kind,owner,key,value)=>list(kind,owner).filter(x=>x[key]===value);
 for(const r of db.prepare("SELECT * FROM records WHERE kind='care_job'").all()){const job=JSON.parse(r.body);if(['queued','running'].includes(job.status))save('care_job',r.owner,{...job,status:'failed',error:'The server restarted. Your saved inputs remain available; retry this request.'})}
 const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}};
 const replay=(owner,key,input,fn)=>atomic(()=>{str(key,'request key',100);const scoped='care-write:'+key,previous=db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(owner,scoped);if(previous){const r=JSON.parse(previous.response);if(r.input!==JSON.stringify(input))fail(409,'This save key belongs to different information.');return r.result}const result=fn();db.prepare('INSERT INTO requests VALUES(?,?,?)').run(owner,scoped,JSON.stringify({input:JSON.stringify(input),result}));return result});
 function context(owner,{plantId,projectId}){
  if(plantId){const plant=own('plant',plantId,owner);return{plant,journal:rows('journal',owner,'plantId',plantId).slice(-30),assessments:rows('assessment',owner,'plantId',plantId).filter(a=>a.status==='completed').slice(-3),rescues:rows('rescue_plan',owner,'plantId',plantId).slice(-2)}}
  const project=foundation.read(owner,'seed-projects',projectId),packet=project.packetId?foundation.read(owner,'seed-packets',project.packetId):null;
  return{project,packet,setup:rows('project_setup',owner,'projectId',projectId).at(-1)||null,plans:rows('seed_plan',owner,'projectId',projectId).slice(-2),events:rows('seed_event',owner,'projectId',projectId).slice(-30),tasks:rows('seed_task',owner,'projectId',projectId).filter(t=>!t.cancelled).slice(-40)};
 }
 function photos(owner,ids){if(ids===undefined)return[];if(!Array.isArray(ids)||ids.length>2)fail(400,'Attach up to two photos.');return ids.map(id=>{const media=own('media',id,owner);return{id:media.id,data:media.data,label:'new customer attachment'}})}
 function launch(owner,type,subject,input,key,request,finish){
  str(key,'AI request key',100);const fingerprint=createHash('sha256').update(JSON.stringify({type,subject,input})).digest('hex'),requestKey='care-job:'+key;
  const previous=db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(owner,requestKey);if(previous){const job=own('care_job',JSON.parse(previous.response).id,owner);if(job.fingerprint!==fingerprint)fail(409,'This request key belongs to a different request.');return job}
  if(active||busy())fail(429,'The care service is busy. Please retry shortly.');if(ai===runCareAI&&!process.env.OPENAI_API_KEY)fail(503,'AI care is not configured.');
  const today=stamp().slice(0,10),jobs=list('care_job',owner).filter(j=>j.created.startsWith(today));if(jobs.length>=15||db.prepare("SELECT COUNT(*) n FROM records WHERE kind='care_job' AND json_extract(body,'$.created')>=?").get(today).n>=Number(process.env.CARE_DAILY_LIMIT||100))fail(429,'The daily AI care limit has been reached. Saved plans and manual tracking remain available.');
  const job={id:randomUUID(),type,subject,fingerprint,status:'queued',created:stamp(),consentAt:stamp()};save('care_job',owner,job);db.prepare('INSERT INTO requests VALUES(?,?,?)').run(owner,requestKey,JSON.stringify({id:job.id}));active++;
  setImmediate(async()=>{try{if(closed||!db.prepare('SELECT id FROM users WHERE id=?').get(owner))return;job.status='running';save('care_job',owner,job);const result=await ai(request);if(closed||!db.prepare('SELECT id FROM users WHERE id=?').get(owner))return;const applied=finish(result,job);Object.assign(job,{result:applied,status:'completed',completed:stamp(),usage:result.usage,model:result.model});save('care_job',owner,job)}catch(e){if(!closed&&db.prepare('SELECT id FROM users WHERE id=?').get(owner)){job.status='failed';job.error=e.message||'Care guidance failed. Please retry.';save('care_job',owner,job)}}finally{active--}});return job;
 }
 function requireConsent(body){if(body.consent!==true)fail(400,'Confirm sending this plant/project context and attached photos to OpenAI.');}
 const readProject=(owner,id)=>{const c=context(owner,{projectId:id});return{...c,latestPlan:c.plans.at(-1)||null,germinationWindow:germinationWindow(c.setup,c.packet,c.project.sowingDate||c.setup?.sowingDate),conversation:foundation.list(owner,'conversations').find(x=>x.projectId===id)||null}};
 return{isBusy:()=>active>0,stop(){closed=true},async route({owner,parts,method,body,key}){
  const [resource,id,sub,index]=parts;
  if(resource==='overview'&&method==='GET')return{status:200,data:{tasks:list('seed_task',owner).filter(t=>!t.cancelled),rescues:list('rescue_plan',owner),events:list('seed_event',owner).slice(-60)}};
  if(resource==='jobs'&&id&&method==='GET')return{status:200,data:own('care_job',id,owner)};
  if(resource==='projects'&&id){
   const c=context(owner,{projectId:id});
   if(method==='GET'&&!sub)return{status:200,data:readProject(owner,id)};
   if(method==='POST'&&sub==='plan'){
    requireConsent(body);if(!db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(owner,'care-job:'+key))await access(owner,'seed');const setup=validateSetup(body.setup);if(body.setup.weatherId){const weather=own('weather_context',body.setup.weatherId,owner);if(weather.projectId!==id)fail(400,'Weather context belongs to a different seed project.');setup.weather=weather;}const packet=c.packet;save('project_setup',owner,{...setup,id:id+'-setup',projectId:id,updated:stamp()});
    const job=launch(owner,'grow_plan',{projectId:id},{setup},key,{type:'seed_grow_plan',context:{...c,setup},message:'Create a personalized seed lifecycle plan from these confirmed inputs.'},(result,job)=>atomic(()=>{
     const previous=rows('seed_plan',owner,'projectId',id),plan={...buildSeedPlan(result,{project:c.project,packet,setup,revision:previous.length+1}),id:randomUUID(),created:stamp(),previousPlanId:previous.at(-1)?.id||null,jobId:job.id};
     save('project_setup',owner,{...setup,id:id+'-setup',projectId:id,updated:stamp()});save('seed_plan',owner,plan);
     for(const task of rows('seed_task',owner,'projectId',id))if(!task.done&&!task.cancelled)save('seed_task',owner,{...task,cancelled:true});
     for(const [i,step] of plan.steps.entries())if(step.due)save('seed_task',owner,{id:plan.id+'-'+i,projectId:id,projectName:c.project.name,planId:plan.id,title:step.title,instructions:step.description,due:step.due,dayOffset:step.dayOffset,done:false,cancelled:false,stage:step.stage,tentative:true});
     if(plan.germinationWindow)for(const [label,date] of [['Germination window opens',plan.germinationWindow.start],['Review germination progress',plan.germinationWindow.end]])save('seed_task',owner,{id:randomUUID(),projectId:id,projectName:c.project.name,planId:plan.id,title:label,due:addDays(date,0),dayOffset:Math.round((Date.parse(date)-Date.parse(setup.sowingDate))/864e5),done:false,cancelled:false,stage:'germination',tentative:false});
     return plan;
    }));return{status:202,data:job};
   }
   if(method==='POST'&&sub==='events'){
    const allowed={sown:'sown',germinated:'germinated',seedling:'seedling','hardening-off':'hardening-off',transplanted:'established',flowering:'flowering',harvest:'harvesting',discontinued:'discontinued',observation:null};if(!Object.hasOwn(allowed,body.type))fail(400,'Choose a seed milestone.');const date=isoDate(body.date);if(body.mediaId)own('media',body.mediaId,owner);const note=typeof body.note==='string'?body.note.slice(0,3000):'';
    const event=replay(owner,key,{projectId:id,type:body.type,date,note,mediaId:body.mediaId||null},()=>{
     const current=foundation.read(owner,'seed-projects',id);const setup=c.setup;if(body.type==='hardening-off'&&setup?.growingMethod!=='indoor-to-outdoor')fail(400,'Hardening off requires an indoor-to-outdoor plan.');
     const e=save('seed_event',owner,{id:randomUUID(),projectId:id,type:body.type,date,note,mediaId:body.mediaId||null,created:stamp()});
     if(allowed[body.type])foundation.write(owner,'seed-projects',{stage:allowed[body.type],...(body.type==='sown'?{sowingDate:date}:{})},id,current.revision,true);
     if(body.type==='sown')for(const t of rows('seed_task',owner,'projectId',id))if(!t.done&&!t.cancelled&&Number.isInteger(t.dayOffset))save('seed_task',owner,{...t,due:addDays(date,t.dayOffset)});
     return e;
    });return{status:201,data:event};
   }
   if(method==='POST'&&sub==='convert'){
    if(!c.project.plantId&&!body.plantId)await access(owner,'plant');
    const result=replay(owner,key,{projectId:id,plantId:body.plantId||null},()=>{const current=foundation.read(owner,'seed-projects',id);if(current.plantId)return own('plant',current.plantId,owner);let plant;if(body.plantId)plant=own('plant',body.plantId,owner);else{plant=save('plant',owner,{id:randomUUID(),name:c.project.name,species:c.packet?.confirmedFields?.scientificName||'Unknown',stage:'Seedling',location:c.setup?.location||'Not specified',status:'Not assessed',image:'sprout',created:stamp(),seedProjectId:id});save('journal',owner,{id:randomUUID(),plantId:plant.id,type:'Milestone',note:'Linked from seed project '+c.project.name+'. Original packet and seed history remain in Seed Studio.',created:stamp()})}foundation.write(owner,'seed-projects',{plantId:plant.id},id,current.revision,true,true);return plant});return{status:201,data:result};
   }
  }
  if(resource==='seed-tasks'&&id&&method==='PATCH'){const t=own('seed_task',id,owner);if(typeof body.done==='boolean')t.done=body.done;if(body.due!==undefined){if(typeof body.due!=='string'||!Number.isFinite(Date.parse(body.due)))fail(400,'Enter a valid reminder date.');isoDate(body.due.slice(0,10));t.due=new Date(body.due).toISOString();t.tentative=false}return{status:200,data:save('seed_task',owner,t)}};
  if(resource==='conversations'){
   if(method==='POST'&&!id){if(!!body.plantId===!!body.projectId)fail(400,'Choose one plant or seed project.');const subject=body.plantId?{plantId:body.plantId}:{projectId:body.projectId};const c=context(owner,subject),existing=foundation.list(owner,'conversations').find(x=>x.plantId===subject.plantId&&x.projectId===subject.projectId);return{status:201,data:existing||foundation.write(owner,'conversations',{...subject,title:(c.plant||c.project).name+' — Plant Doctor'})}}
   const conversation=foundation.read(owner,'conversations',id),subject=conversation.plantId?{plantId:conversation.plantId}:{projectId:conversation.projectId};
   if(method==='GET'&&!sub)return{status:200,data:{conversation,messages:foundation.messages(owner,id)}};
   if(method==='POST'&&sub==='messages'){
    requireConsent(body);if(!db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(owner,'care-job:'+key))await access(owner,body.mediaIds?.length?'photo-conversation':'question');const text=str(body.text,'your question',4000),attached=photos(owner,body.mediaIds);const c=context(owner,subject),messages=foundation.messages(owner,id).slice(-20);
    const previousImage=c.assessments?.at(-1)?.mediaId;if(previousImage&&!attached.some(p=>p.id===previousImage)){const media=own('media',previousImage,owner);attached.unshift({id:media.id,data:media.data,label:'previous saved evidence photo'})}
    const job=launch(owner,'doctor',{...subject,conversationId:id},{text,mediaIds:body.mediaIds||[]},key,{type:'plant_doctor_conversation',context:{...c,messages},message:text,photos:attached},(result,job)=>{
     const response={id:randomUUID(),role:'assistant',text:result.summary,observations:result.observations,possibleCauses:result.possibleCauses,questions:result.questions,warnings:result.warnings,proposals:result.proposals,created:stamp(),jobId:job.id};db.prepare('INSERT INTO foundation_messages VALUES(?,?,?)').run(response.id,id,JSON.stringify(response));return response;
    });if(job.status==='queued'&&!foundation.messages(owner,id).some(m=>m.jobId===job.id)){
     const userMessage=foundation.append(owner,id,{text,mediaIds:body.mediaIds||[]});userMessage.jobId=job.id;db.prepare('UPDATE foundation_messages SET body=? WHERE id=?').run(JSON.stringify(userMessage),userMessage.id);
    }return{status:202,data:job};
   }
  }
  if(resource==='jobs'&&sub==='actions'&&method==='POST'){
   const job=own('care_job',id,owner);if(job.status!=='completed'||job.type!=='doctor'||body.confirmed!==true)fail(400,'Confirm an available Doctor action.');const n=Number(index),proposal=job.result.proposals?.[n];if(!Number.isInteger(n)||!proposal)fail(404,'Action not found.');const c=context(owner,job.subject);
   const result=replay(owner,'doctor-action-'+id+'-'+n,{jobId:id,index:n},()=>{if(proposal.type==='reminder'){const kind=job.subject.projectId?'seed_task':'task';return save(kind,owner,{id:randomUUID(),...job.subject,projectName:c.project?.name,title:proposal.title,due:addDays(stamp().slice(0,10),proposal.dueInDays),done:false,created:stamp()})}return job.subject.projectId?save('seed_event',owner,{id:randomUUID(),projectId:job.subject.projectId,type:'observation',date:stamp().slice(0,10),note:proposal.text,created:stamp()}):save('journal',owner,{id:randomUUID(),plantId:job.subject.plantId,type:'Note',note:proposal.text,created:stamp()})});return{status:201,data:{applied:true,record:result}};
  }
  if(resource==='plants'&&id){
   const c=context(owner,{plantId:id});if(method==='GET')return{status:200,data:{...c,rescues:rows('rescue_plan',owner,'plantId',id),checkpoints:list('rescue_check',owner).filter(x=>x.plantId===id)}};
   if(method==='POST'&&sub==='rescue'){
    requireConsent(body);if(!db.prepare('SELECT response FROM requests WHERE owner=? AND key=?').get(owner,'care-job:'+key))await access(owner,'rescue');const note=str(body.note,'the recovery concern',3000),attached=photos(owner,body.mediaIds);if(!attached.length&&c.assessments.at(-1)?.mediaId){const media=own('media',c.assessments.at(-1).mediaId,owner);attached.push({id:media.id,data:media.data,label:'latest saved assessment photo'})}
    return{status:202,data:launch(owner,'rescue',{plantId:id},{note,mediaIds:body.mediaIds||[]},key,{type:'fourteen_day_plant_rescue',context:c,message:note,photos:attached},(result,job)=>atomic(()=>{const previous=rows('rescue_plan',owner,'plantId',id),plan=save('rescue_plan',owner,{...result,id:randomUUID(),plantId:id,created:stamp(),status:'active',revision:previous.length+1,previousPlanId:previous.at(-1)?.id||null,initialMediaIds:attached.map(p=>p.id),jobId:job.id,steps:result.steps.filter(s=>s.dayOffset===null||s.dayOffset<=14)});for(const day of [3,7,14])save('task',owner,{id:randomUUID(),plantId:id,rescueId:plan.id,title:`${c.plant.name}: recovery photo check (day ${day})`,due:addDays(stamp().slice(0,10),day),done:false});return plan}))};
   }
  }
  if(resource==='rescues'&&id){
   const plan=own('rescue_plan',id,owner),c=context(owner,{plantId:plan.plantId});
   if(method==='PATCH'){if(body.status!=='completed')fail(400,'Only explicit plan completion is supported.');return{status:200,data:atomic(()=>{for(const task of rows('task',owner,'rescueId',id))if(!task.done)save('task',owner,{...task,done:true,completed:stamp(),completionReason:'Rescue plan completed'});return save('rescue_plan',owner,{...plan,status:'completed',completed:stamp()})})}}
   if(method==='POST'&&sub==='checkpoints'){
    requireConsent(body);const note=str(body.note,'your follow-up observations',3000),attached=photos(owner,body.mediaIds),prior=plan.initialMediaIds?.[0];if(prior&&!attached.some(p=>p.id===prior)){const media=own('media',prior,owner);attached.unshift({id:media.id,data:media.data,label:'previous saved evidence photo'})}
    return{status:202,data:launch(owner,'rescue_check',{plantId:plan.plantId,rescueId:id},{note,mediaIds:body.mediaIds||[]},key,{type:'rescue_follow_up_comparison',context:{...c,rescuePlan:plan,previousCheckpoints:rows('rescue_check',owner,'rescueId',id).slice(-3)},message:note,photos:attached},(result,job)=>save('rescue_check',owner,{...result,progress:new Set(attached.map(p=>p.id)).size<2?'insufficient_evidence':result.progress,id:randomUUID(),plantId:plan.plantId,rescueId:id,note,mediaIds:body.mediaIds||[],created:stamp(),jobId:job.id}))};
   }
  }
  fail(404,'Care endpoint not found.');
 }};
}
