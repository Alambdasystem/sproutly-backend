const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export const methods=['indoor','outdoor','indoor-to-outdoor','container'];
export const isoDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(400,'Use a valid date in YYYY-MM-DD format.');return value};
export const addDays=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*864e5).toISOString();
export function validateSetup(input){
 if(!input||typeof input!=='object'||!methods.includes(input.growingMethod))fail(400,'Choose a growing method.');
 const out={growingMethod:input.growingMethod,sowingDate:isoDate(input.sowingDate)};
 for(const k of ['location','gardenSetup','sunlight','temperature','soil','experience']){if(input[k]!==undefined&&(typeof input[k]!=='string'||input[k].length>500))fail(400,'Invalid growing setup.');out[k]=input[k]?.trim()||'Not specified'}
 if(input.lastFrostDate)out.lastFrostDate=isoDate(input.lastFrostDate);
 for(const k of ['germinationMin','germinationMax'])if(input[k]!==undefined&&input[k]!==null&&input[k]!==''){const v=Number(input[k]);if(!Number.isInteger(v)||v<1||v>1500)fail(400,'Germination days must be whole numbers from 1 to 1500.');out[k]=v}
 if(out.germinationMin&&out.germinationMax&&out.germinationMin>out.germinationMax)fail(400,'The germination range is reversed.');
 if(input.instructionsConfirmed!==true)fail(400,'Review the packet instructions before generating a plan.');out.instructionsConfirmed=true;
 return out;
}
export function germinationWindow(setup,packet,sowingDate){
 const fields=packet?.confirmedFields||{};const min=setup?.germinationMin??Number(fields.germinationDaysMin),max=setup?.germinationMax??Number(fields.germinationDaysMax);
 if(!sowingDate||!Number.isInteger(min)||min<1||!Number.isInteger(max)||max<min||max>1500)return null;
 return{start:addDays(isoDate(sowingDate),min).slice(0,10),end:addDays(sowingDate,max).slice(0,10),source:setup?.germinationMin||setup?.germinationMax?'customer-entered range':'customer-confirmed packet',minimumDays:min,maximumDays:max};
}
export function buildSeedPlan(ai,{project,packet,setup,revision=1}){
 const window=germinationWindow(setup,packet,setup.sowingDate);const steps=ai.steps.filter(s=>setup.growingMethod==='indoor-to-outdoor'||!['hardening-off','transplanting'].includes(s.stage)).map(s=>({...s,dayOffset:s.stage==='germination'?null:s.dayOffset,due:null,source:s.source==='packet'&&!packet?.instructions&&!packet?.confirmedFields?'ai':s.source}));
 // Suggested milestone dates remain tentative; only packet/user germination ranges are firm inputs.
 for(const step of steps)if(step.dayOffset!==null)step.due=addDays(setup.sowingDate,step.dayOffset);
 const warnings=[...ai.warnings];if(!window)warnings.push('No confirmed germination range is available. Check the packet or enter a range; no exact germination dates were invented.');
 if(setup.growingMethod!=='indoor'&&!setup.lastFrostDate)warnings.push('No local frost date was provided. Confirm outdoor planting and transplant conditions before acting.');
 return{...ai,steps,setup,projectId:project.id,packetId:packet?.id||null,revision,germinationWindow:window,warnings,sourceNotice:'Packet instructions and customer inputs are separate from AI suggestions. Suggested task dates need your review.',scheduleAnchor:setup.sowingDate};
}
