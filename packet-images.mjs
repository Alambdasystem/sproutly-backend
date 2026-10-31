import sharp from 'sharp';
import {createWorker} from 'tesseract.js';
import english from '@tesseract.js-data/eng';
sharp.cache(false);sharp.concurrency(1);
export function imageBytes(data){if(typeof data!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data))throw Object.assign(new Error('Use a JPEG, PNG or WebP packet photo.'),{status:400});return Buffer.from(data.slice(data.indexOf(',')+1),'base64')}
export async function preparePacketImage(data,{rotation=0,crop={left:0,top:0,right:0,bottom:0}}={}){
 if(![0,90,180,270].includes(rotation)||!crop||Object.keys(crop).some(k=>!['left','top','right','bottom'].includes(k)))throw Object.assign(new Error('Invalid photo adjustment.'),{status:400});
 const margins={left:0,top:0,right:0,bottom:0,...crop};if(Object.values(margins).some(n=>!Number.isFinite(n)||n<0||n>80)||margins.left+margins.right>80||margins.top+margins.bottom>80)throw Object.assign(new Error('Keep at least 20% of the photo in each direction.'),{status:400});
 try{
  const source=imageBytes(data),oriented=await sharp(source,{limitInputPixels:24000000}).autoOrient().rotate(rotation).resize({width:2200,height:2200,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  const {width,height}=oriented.info,left=Math.floor(width*margins.left/100),top=Math.floor(height*margins.top/100),w=width-left-Math.floor(width*margins.right/100),h=height-top-Math.floor(height*margins.bottom/100);
  if(Math.min(w,h)<180)throw new Error('The photo is too small. Retake it closer and keep the text sharp.');
  const output=await sharp(oriented.data).extract({left,top,width:w,height:h}).jpeg({quality:90}).toBuffer();
  return{data:'data:image/jpeg;base64,'+output.toString('base64'),width:w,height:h,warnings:Math.min(w,h)<600?['Small image: take a closer, sharper photo if packet text is difficult to read.']:[]};
 }catch(e){throw Object.assign(new Error(e.status?e.message:'The photo could not be read or is too small. Use a clear JPEG, PNG or WebP photo under 24 megapixels.'),{status:400})}
}
export async function readPacketText(images){
 let worker,timer;const results=[];
 try{
  worker=await createWorker('eng',1,{langPath:english.langPath,gzip:true,cacheMethod:'none',errorHandler:()=>{}});
  for(const image of images){const result=await Promise.race([worker.recognize(imageBytes(image.data),{},{text:true,blocks:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Packet text recognition timed out. Try a clearer photo.')),25000)})]);clearTimeout(timer);results.push({text:String(result.data.text||'').slice(0,16000),confidence:result.data.confidence,blocks:(result.data.blocks||[]).slice(0,100).map(b=>({text:String(b.text||'').slice(0,2000),box:b.bbox}))})}
  return results;
 }finally{clearTimeout(timer);if(worker)await worker.terminate()}
}
