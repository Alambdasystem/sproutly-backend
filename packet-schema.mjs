export const packetFieldKeys=['commonName','scientificName','variety','brand','productName','productNumber','barcode','seedCategory','indoorStart','directSow','plantingDepth','seedSpacing','plantSpacing','rowSpacing','germinationDaysMin','germinationDaysMax','daysToMaturity','soilTemperatureMin','soilTemperatureMax','soilTemperatureUnit','sunlight','moisture','plantingSeason','specialInstructions','quantity','lotNumber','packedFor','warnings','heightOrSpread'];
export const confidenceValues=['high','needs_confirmation','not_detected','conflicting'];
export const packetSchema={type:'object',additionalProperties:false,properties:{imageQuality:{type:'string',enum:['usable','needs_better_photo','not_packet']},summary:{type:'string'},warnings:{type:'array',items:{type:'string'},maxItems:10},fields:{type:'array',maxItems:29,items:{type:'object',additionalProperties:false,properties:{key:{type:'string',enum:packetFieldKeys},value:{type:['string','null']},confidence:{type:'string',enum:confidenceValues},evidence:{type:'string'},imageIndex:{type:['integer','null'],minimum:0,maximum:3}},required:['key','value','confidence','evidence','imageIndex']}}},required:['imageQuality','summary','warnings','fields']};
export function validatePacketResult(result,imageCount){
 if(!result||!['usable','needs_better_photo','not_packet'].includes(result.imageQuality)||typeof result.summary!=='string'||result.summary.length>2000||!Array.isArray(result.warnings)||result.warnings.length>10||result.warnings.some(x=>typeof x!=='string'||x.length>1000)||!Array.isArray(result.fields)||result.fields.length>29)throw new Error('Packet extraction returned invalid structured data. Please retry.');
 const seen=new Set();
 const fields=result.fields.map(f=>{
  if(!f||!packetFieldKeys.includes(f.key)||seen.has(f.key)||!confidenceValues.includes(f.confidence)||(f.value!==null&&(typeof f.value!=='string'||f.value.length>2000))||typeof f.evidence!=='string'||f.evidence.length>2000||(f.imageIndex!==null&&(!Number.isInteger(f.imageIndex)||f.imageIndex<0||f.imageIndex>=imageCount)))throw new Error('Packet extraction returned invalid fields. Please retry.');seen.add(f.key);
  const clean={key:f.key,value:f.value?.trim()||null,confidence:f.confidence,evidence:f.evidence,imageIndex:f.imageIndex};
  if(!clean.value)clean.confidence='not_detected';
  if(clean.value&&(!clean.evidence.trim()||clean.imageIndex===null||clean.confidence==='not_detected'))clean.confidence='needs_confirmation';
  if(['germinationDaysMin','germinationDaysMax','daysToMaturity'].includes(f.key)&&clean.value&&(!/^\d{1,4}$/.test(clean.value)||Number(clean.value)<1||Number(clean.value)>1500))clean.confidence='needs_confirmation';
  if(['soilTemperatureMin','soilTemperatureMax'].includes(f.key)&&clean.value&&(!/^-?\d{1,3}(\.\d+)?$/.test(clean.value)||Number(clean.value)<-50||Number(clean.value)>150))clean.confidence='needs_confirmation';
  if(f.key==='soilTemperatureUnit'&&clean.value&&!['C','F'].includes(clean.value))clean.confidence='needs_confirmation';
  if(f.key==='barcode'&&clean.value&&!/^\d{8,14}$/.test(clean.value))clean.confidence='needs_confirmation';
  if(f.key==='plantingDepth'&&clean.value&&!/\b(inches|inch|in|cm|mm)\b|["″]/i.test(clean.value))clean.confidence='needs_confirmation';
  return clean;
 });
 for(const key of packetFieldKeys)if(!seen.has(key))fields.push({key,value:null,confidence:'not_detected',evidence:'',imageIndex:null});
 for(const [min,max] of [['germinationDaysMin','germinationDaysMax'],['soilTemperatureMin','soilTemperatureMax']]){const a=fields.find(f=>f.key===min),b=fields.find(f=>f.key===max);if(a.value&&b.value&&Number(a.value)>Number(b.value)){a.confidence='conflicting';b.confidence='conflicting'}}
 if(result.imageQuality!=='usable')for(const f of fields){f.confidence=f.value?'needs_confirmation':'not_detected'}
 return{imageQuality:result.imageQuality,summary:result.summary,warnings:result.warnings,fields};
}
export function validateConfirmedFields(values){
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(k=>!packetFieldKeys.includes(k)))throw Object.assign(new Error('Invalid confirmed packet fields.'),{status:400});
 const result={};for(const [key,value] of Object.entries(values)){if(typeof value!=='string'||value.length>2000)throw Object.assign(new Error('Invalid packet field value.'),{status:400});result[key]=value.trim()}
 for(const key of ['germinationDaysMin','germinationDaysMax','daysToMaturity'])if(result[key]&&(!/^\d{1,4}$/.test(result[key])||+result[key]<1||+result[key]>1500))throw Object.assign(new Error('Days must be whole numbers between 1 and 1500; clear an uncertain value.'),{status:400});
 if(result.germinationDaysMin&&result.germinationDaysMax&&+result.germinationDaysMin>+result.germinationDaysMax)throw Object.assign(new Error('The germination range is reversed.'),{status:400});
 for(const key of ['soilTemperatureMin','soilTemperatureMax'])if(result[key]&&(!/^-?\d{1,3}(\.\d+)?$/.test(result[key])||+result[key]<-50||+result[key]>150))throw Object.assign(new Error('Check the soil temperature values or clear them.'),{status:400});
 if(result.soilTemperatureMin&&result.soilTemperatureMax&&+result.soilTemperatureMin>+result.soilTemperatureMax)throw Object.assign(new Error('The soil temperature range is reversed.'),{status:400});
 if((result.soilTemperatureMin||result.soilTemperatureMax)&&!['C','F'].includes(result.soilTemperatureUnit))throw Object.assign(new Error('Confirm soil temperature units as C or F, or clear the temperatures.'),{status:400});
 if(result.barcode&&!/^\d{8,14}$/.test(result.barcode))throw Object.assign(new Error('Confirm a barcode of 8–14 digits, or clear it.'),{status:400});
 if(result.plantingDepth&&!/\b(inches|inch|in|cm|mm)\b|["″]|surface|do not cover/i.test(result.plantingDepth))throw Object.assign(new Error('Include planting depth units (inches, cm or mm), or state surface sow.'),{status:400});
 return result;
}
