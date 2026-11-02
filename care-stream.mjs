// Only the leading summary string is previewed. Other fields remain private until validation.
export function summaryPreview(json){
 const start=/^\s*\{\s*"summary"\s*:\s*"/.exec(json);if(!start)return '';
 let text='';for(let i=start[0].length;i<json.length&&text.length<6000;i++){
  const c=json[i];if(c==='"')break;
  if(c!=='\\'){if(c.charCodeAt(0)<32)return '';text+=c;continue}
  const e=json[++i];if(e===undefined)break;
  if(e==='u'){const hex=json.slice(i+1,i+5);if(hex.length<4)break;if(!/^[0-9a-f]{4}$/i.test(hex))return '';text+=String.fromCharCode(parseInt(hex,16));i+=4}
  else{const escapes={'"':'"','\\':'\\','/':'/','n':'\n','r':'\r','t':'\t','b':'\b','f':'\f'};if(!Object.hasOwn(escapes,e))return '';text+=escapes[e]}
 }return text.replace(/[\uD800-\uDBFF]$/,'');
}
export async function readCareStream(response,onPreview){
 if(!response.body)throw new Error('The AI stream was unavailable. Please retry.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',output='',complete=null,last='';
 const event=frame=>{const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')return;const value=JSON.parse(data);
  if(value.type==='response.output_text.delta'){if(typeof value.delta!=='string')throw new Error('Invalid care stream.');output+=value.delta;if(output.length>150000)throw new Error('Care response exceeded its limit.');const preview=summaryPreview(output);if(preview!==last){last=preview;onPreview(preview)}}
  if(value.type==='response.completed')complete=value.response;
  if(['error','response.failed','response.incomplete','response.refusal.delta','response.refusal.done'].includes(value.type))throw new Error('The AI could not complete this guidance. Please retry.');
 };
 try{while(true){const {done,value}=await reader.read();pending+=done?decoder.decode():decoder.decode(value,{stream:true});pending=pending.replace(/\r\n/g,'\n');if(pending.length>250000)throw new Error('Care stream event exceeded its limit.');let at;while((at=pending.indexOf('\n\n'))>=0){event(pending.slice(0,at));pending=pending.slice(at+2)}if(done)break}if(pending.trim())event(pending);if(!complete||complete.status!=='completed')throw new Error('AI care was incomplete. Your question is saved; please retry.');return complete;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
