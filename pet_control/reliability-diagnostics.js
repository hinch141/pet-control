'use strict';
// Read-only, bounded diagnostics. No credentials, pet names or event payloads.
function createReliabilityDiagnostics({clock=()=>Date.now(),limit=120}={}){
 const entries=[];
 const record=(source,operation,startedAt,{ok=false,status=null,sourceUpdatedAt=null,error=null}={})=>{
  const now=clock(),durationMs=Math.max(0,now-startedAt);
  const item={at:new Date(now).toISOString(),source:String(source).slice(0,32),operation:String(operation).slice(0,40),durationMs,ok:!!ok,status:Number.isInteger(status)?status:null,sourceAgeMs:sourceUpdatedAt&&Number.isFinite(Date.parse(sourceUpdatedAt))?Math.max(0,now-Date.parse(sourceUpdatedAt)):null,error:error?String(error).replace(/https?:\/\/\S+/g,'[url]').slice(0,80):null};
  entries.push(item);if(entries.length>limit)entries.shift();return item;
 };
 const snapshot=()=>({generatedAt:new Date(clock()).toISOString(),sampleCount:entries.length,recent:entries.slice(-30).reverse()});
 return {record,snapshot};
}
module.exports={createReliabilityDiagnostics};
