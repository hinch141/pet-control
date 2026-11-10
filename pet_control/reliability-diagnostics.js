'use strict';
// Bounded, privacy-minimised diagnostics. No tokens, URLs, pet names or payloads.
const fs=require('node:fs');
const path=require('node:path');
function createReliabilityDiagnostics({clock=()=>Date.now(),limit=240,file='/data/pet-hq-reliability.json',persist=true}={}){
 const entries=[];
 const allowedSources=new Set(['sure_cloud','home_assistant','pet_hq']);
 const allowedOperations=new Set(['cloud_request','positions','activity','flap_state','pet_presence','house_lock_command','individual_access_command','movement_observed']);
 const allowedErrors=new Set(['timeout','rate_limited','authentication','http_error','network','unavailable','not_confirmed','read_failed','request_failed','connection_error','timeline_error','household_error','authentication_error','not_configured','unknown']);
 const finite=n=>Number.isFinite(n)?Math.max(0,Math.round(n)):null;
 let lastSaved=0;
 function clean(e){
  if(!e||typeof e!=='object'||!Number.isFinite(Date.parse(e.at)))return null;
  return {at:new Date(e.at).toISOString(),source:allowedSources.has(e.source)?e.source:'pet_hq',operation:allowedOperations.has(e.operation)?e.operation:'cloud_request',durationMs:finite(e.durationMs),ok:e.ok===true,status:Number.isInteger(e.status)&&e.status>=100&&e.status<=599?e.status:null,sourceAgeMs:finite(e.sourceAgeMs),queueMs:finite(e.queueMs),networkMs:finite(e.networkMs),cacheHit:e.cacheHit===true,error:allowedErrors.has(e.error)?e.error:null};
 }
 if(persist){try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(saved))for(const raw of saved.slice(-limit)){const e=clean(raw);if(e)entries.push(e);}}catch{}}
 function save(){
  if(!persist)return;
  try{
   const tmp=file+'.tmp';
   fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.writeFileSync(tmp,JSON.stringify(entries),{mode:0o600});
   fs.renameSync(tmp,file);
   lastSaved=clock();
  }catch{} // Diagnostics must never interrupt pet access.
 }
 function record(source,operation,startedAt,{ok=false,status=null,sourceUpdatedAt=null,error=null,queueMs=null,networkMs=null,cacheHit=false}={}){
  const now=clock();
  const item=clean({at:new Date(now).toISOString(),source,operation,durationMs:now-startedAt,ok,status,sourceAgeMs:sourceUpdatedAt&&Number.isFinite(Date.parse(sourceUpdatedAt))?Math.max(0,now-Date.parse(sourceUpdatedAt)):null,error,queueMs,networkMs,cacheHit});
  entries.push(item);if(entries.length>limit)entries.shift();
  if(now-lastSaved>=15000)save();
  return item;
 }
 const snapshot=()=>({generatedAt:new Date(clock()).toISOString(),sampleCount:entries.length,recent:entries.slice(-60).reverse(),retention:{maxRecords:limit,storage:'bounded local file',persisted:persist}});
 return {record,snapshot,flush:save};
}
module.exports={createReliabilityDiagnostics};
