'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const base='/usr/share/pet-control';
const pets=['jessie','henry','rosie','violet'];
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const token=process.env.SUPERVISOR_TOKEN;
const {createAccessVerifier}=require('./access-verifier');
const {createReliabilityDiagnostics}=require('./reliability-diagnostics');
const reliabilityDiagnostics=createReliabilityDiagnostics();
 // Optional Home Assistant local-disk share. Never create the mount directory:
 // if the USB is absent, archives must not silently fill internal /share.
 const usbArchiveRoot='/share/Pet_HQ_Logs';
 const usbArchiveFiles=['sure-activity-cache.json','sure-archive-progress.json','pet-hq-reliability.json'];
 const usbArchiveState={connected:false,lastSync:null,lastError:null,files:[]};
 const usbArchiveHashes=new Map();
 function syncUsbArchive(){
  try{
   if(!fs.existsSync(usbArchiveRoot)||!fs.statSync(usbArchiveRoot).isDirectory())throw Error('USB share is not mounted');
   const destination=path.join(usbArchiveRoot,'Pet_HQ_Archive');
   // Write test is required before reporting connected. Do not touch live data.
   fs.accessSync(usbArchiveRoot,fs.constants.W_OK);
   fs.mkdirSync(destination,{recursive:true});
   const copied=[];
   for(const name of usbArchiveFiles){
    const source=path.join('/data',name);
    if(!fs.existsSync(source))continue;
    const stat=fs.statSync(source);
    const signature=stat.size+':'+stat.mtimeMs;
    const target=path.join(destination,name);
    if(usbArchiveHashes.get(name)!==signature||!fs.existsSync(target)){
     const tmp=target+'.tmp';
     fs.copyFileSync(source,tmp);
     fs.renameSync(tmp,target);
     usbArchiveHashes.set(name,signature);
    }
    copied.push(name);
   }
   usbArchiveState.connected=true;usbArchiveState.lastSync=new Date().toISOString();
   usbArchiveState.lastError=null;usbArchiveState.files=copied;
  }catch(error){
   usbArchiveState.connected=false;
   usbArchiveState.lastError=String(error.message||error).slice(0,140);
   usbArchiveHashes.clear();
  }
 }
 setTimeout(syncUsbArchive,10000);
 setInterval(syncUsbArchive,60000);

let standaloneOptions={};
try{standaloneOptions=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
const familyFile='/data/pet-hq-family.json';
const initialFamilyEmails=String(standaloneOptions.access_emails||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
let family={version:1,members:initialFamilyEmails.map(email=>({email,name:email.split('@')[0],primary:true,addedAt:new Date().toISOString()}))};
try{
 const saved=JSON.parse(fs.readFileSync(familyFile,'utf8'));
 if(saved?.version===1&&Array.isArray(saved.members)&&saved.members.length)family=saved;
}catch(e){if(e.code!=='ENOENT')console.error('Family registry read failed:',e.message);}
// Name migration for existing household accounts; preserve IDs, permissions and additions.
for(const member of family.members){
 if(member.email==='hinchi1@gmail.com'&&member.primary&&member.name==='hinchi1')member.name='John';
 if(member.email==='nicky.hinchliffe@gmail.com'&&member.primary&&member.name==='nicky.hinchliffe')member.name='Nicky';
}
function saveFamily(){
 const tmp=familyFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(family,null,2),{mode:0o600});fs.renameSync(tmp,familyFile);
}
// One-time household email correction. Existing primary account stays intact.
// Run before access verification is configured, then persist atomically.
const previousNickyEmail='nicky.hinchliffe@gmail.com';
const correctedNickyEmail='nicky.hinchliffe1@gmail.com';
const oldNicky=family.members.find(m=>m.email===previousNickyEmail);
if(oldNicky){
 const existing=family.members.find(m=>m.email===correctedNickyEmail);
 if(existing){
  // Preserve the primary account and avoid duplicate email identities.
  existing.primary=Boolean(existing.primary||oldNicky.primary);
  if(oldNicky.primary&&(!existing.name||existing.name===correctedNickyEmail.split('@')[0]))existing.name=oldNicky.name||'Nicky';
  family.members=family.members.filter(m=>m!==oldNicky);
 }else{
  oldNicky.email=correctedNickyEmail;
 }
 saveFamily();
}
const emailAllowed=email=>family.members.some(m=>m.email===email);
try{if(family.members.some(m=>(m.email==='hinchi1@gmail.com'&&m.name==='John')||(m.email==='nicky.hinchliffe@gmail.com'&&m.name==='Nicky')))saveFamily();}catch(e){console.error('Family name update failed:',e.message);}
let verifyStandalone=null;
try {
  if(standaloneOptions.access_team_domain&&standaloneOptions.access_audience&&standaloneOptions.access_emails){
    verifyStandalone=createAccessVerifier({teamDomain:standaloneOptions.access_team_domain,audience:standaloneOptions.access_audience,allowedEmails:String(standaloneOptions.access_emails).split(','),isEmailAllowed:emailAllowed});
  }
} catch(error) {console.error('Standalone access disabled: invalid configuration:',error.message);}
const standaloneEnabled=!!verifyStandalone;
let activitySnapshot=null,activityPending=null;
let lastMovementObservedAt=0;
const observedMovementIds=new Set();
const lastPetStates=new Map();

// Real-time Home Assistant WebSocket state cache + SSE broadcast hub
const sseClients=new Set();
const liveEntityCache=new Map();
let haWsConnected=false,haWs=null,haWsMsgId=1,haWsSubId=null,haWsReconnectTimer=null;
const trackedEntities=new Set([...pets.map(p=>'binary_sensor.'+p),'lock.my_flap_locked_out']);

function broadcastSse(event,payload){
 if(!sseClients.size)return;
 const frame='event: '+event+'\ndata: '+JSON.stringify(payload)+'\n\n';
 for(const client of sseClients){
  try{client.write(frame);}catch{sseClients.delete(client);}
 }
}

function buildStatusSnapshot(){
 return {
  pets:pets.map(p=>{
   const ent=liveEntityCache.get('binary_sensor.'+p);
   return {name:p,state:ent?.state||'unknown',changed:ent?.last_changed||null};
  }),
  updated:new Date().toISOString()
 };
}

function buildFlapSnapshot(){
 const ent=liveEntityCache.get('lock.my_flap_locked_out');
 const state=String(ent?.state||'unknown');
 const status=state==='locked'?'indoor_only':state==='unlocked'?'normal':'unknown';
 return {entity_id:'lock.my_flap_locked_out',state,status,updated:ent?.last_updated||null};
}

function applyHaEntityState(entityObj){
 if(!entityObj||!trackedEntities.has(entityObj.entity_id))return;
 const id=entityObj.entity_id;
 liveEntityCache.set(id,{state:String(entityObj.state||'unknown'),last_changed:entityObj.last_changed||null,last_updated:entityObj.last_updated||null});
 if(id.startsWith('binary_sensor.')){
  const petName=id.slice('binary_sensor.'.length);
  const previous=lastPetStates.get(petName);
  if(previous!==undefined&&previous!==entityObj.state){
   const movement=entityObj.state==='on'?'In':entityObj.state==='off'?'Out':null;
   if(movement)reliabilityDiagnostics.record('home_assistant','pet_status_change',Date.now(),{ok:true,pet:petName,movement,eventAt:entityObj.last_changed});
  }
  lastPetStates.set(petName,entityObj.state);
  broadcastSse('status',buildStatusSnapshot());
 }else if(id==='lock.my_flap_locked_out'){
  broadcastSse('flap',buildFlapSnapshot());
 }
}

function connectHaWebSocket(){
 if(!token||typeof WebSocket==='undefined')return;
 if(haWs){try{haWs.close();}catch{}haWs=null;}
 haWsConnected=false;
 try{
  const ws=new WebSocket('ws://supervisor/core/websocket');
  haWs=ws;
  ws.onmessage=ev=>{
   let msg;try{msg=JSON.parse(String(ev.data));}catch{return;}
   if(msg.type==='auth_required'){
    ws.send(JSON.stringify({type:'auth',access_token:token}));
   }else if(msg.type==='auth_ok'){
    haWsConnected=true;
    const statesId=haWsMsgId++;
    haWsSubId=haWsMsgId++;
    ws.send(JSON.stringify({id:statesId,type:'get_states'}));
    ws.send(JSON.stringify({id:haWsSubId,type:'subscribe_events',event_type:'state_changed'}));
   }else if(msg.type==='result'&&Array.isArray(msg.result)){
    for(const ent of msg.result)applyHaEntityState(ent);
   }else if(msg.type==='event'&&msg.event?.event_type==='state_changed'){
    applyHaEntityState(msg.event.data?.new_state);
   }
  };
  ws.onclose=()=>{
   haWsConnected=false;
   haWs=null;
   clearTimeout(haWsReconnectTimer);
   haWsReconnectTimer=setTimeout(connectHaWebSocket,5000);
  };
  ws.onerror=()=>{try{ws.close();}catch{}};
 }catch{
  clearTimeout(haWsReconnectTimer);
  haWsReconnectTimer=setTimeout(connectHaWebSocket,5000);
 }
}
connectHaWebSocket();
setInterval(()=>{
 for(const client of sseClients){
  try{client.write(': ping\n\n');}catch{sseClients.delete(client);}
 }
},25000);

// Durable pet archive: stored in Home Assistant add-on /data, not browser storage.
const petArchiveFile='/data/pet-hq-archived-pets.json';
let petArchive={version:1,pets:{}};
try{
 const saved=JSON.parse(fs.readFileSync(petArchiveFile,'utf8'));
 if(saved&&saved.version===1&&saved.pets&&typeof saved.pets==='object'&&!Array.isArray(saved.pets))petArchive=saved;
}catch(e){if(e.code!=='ENOENT')console.error('Pet archive could not be read:',e.message);}
function writePetArchive(){
 const tmp=petArchiveFile+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(petArchive,null,2),{mode:0o600});
 fs.renameSync(tmp,petArchiveFile);
}
const curfewFile='/data/whole_house_curfew.json';
let curfew={enabled:false,ranges:[{start:'10:00',end:'10:01'}],phase:'off',ownsLock:false,lastError:'',override:false};
try{const saved=JSON.parse(fs.readFileSync(curfewFile,'utf8'));curfew={...curfew,...saved};if(!Array.isArray(saved.ranges))curfew.ranges=[{start:saved.start||'10:00',end:saved.end||'10:01'}];if(saved.enabled&&saved.date){curfew.enabled=!!saved.ownsLock;curfew.phase=saved.ownsLock?'active':'off';curfew.lastError='Previous one-off schedule was migrated. Review the new daily time ranges.';}}catch{}
function saveCurfew(){fs.writeFileSync(curfewFile,JSON.stringify(curfew),{mode:0o600});broadcastSse('curfew',{wholeHouse:true});}
function londonDateTime(date=new Date()){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};}
let curfewBusy=false;
async function readCurfewFlap(){
 if(haWsConnected&&liveEntityCache.has('lock.my_flap_locked_out')){
  const cached=liveEntityCache.get('lock.my_flap_locked_out').state;
  if(cached==='locked'||cached==='unlocked')return cached;
 }
 if(!token)throw Error('Home Assistant connection unavailable');
 const r=await fetch('http://supervisor/core/api/states/lock.my_flap_locked_out',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(6000)});
 if(!r.ok)throw Error('Unable to read flap state');
 const state=String((await r.json()).state);
 if(state!=='locked'&&state!=='unlocked')throw Error('Flap state unknown');
 return state;
}
async function curfewCommand(mode){
 const desired=mode==='indoor_only'?'locked':'unlocked';
 const before=await readCurfewFlap();
 if(before===desired)return before;
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const action=desired==='locked'?'lock':'unlock';
 const r=await fetch('http://supervisor/core/api/services/lock/'+action,{method:'POST',headers,body:JSON.stringify({entity_id:'lock.my_flap_locked_out'}),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('Home Assistant rejected flap command');
 for(let i=0;i<5;i++){if(await readCurfewFlap()===desired)return before;if(i<4)await new Promise(resolve=>setTimeout(resolve,1000));}
 throw Error('Flap state not yet confirmed');
}
function curfewInRange(time,range){return range.start<range.end?(time>=range.start&&time<range.end):(time>=range.start||time<range.end);}
async function curfewTick(){
 if(curfewBusy||!curfew.enabled)return;
 curfewBusy=true;
 try{
  const now=londonDateTime(),active=curfew.ranges.some(r=>curfewInRange(now.time,r));
  if(active){
   if(curfew.phase!=='active'&&curfew.phase!=='overridden'){
    const before=await readCurfewFlap();
    if(before==='unlocked'){curfew.ownsLock=true;saveCurfew();}
    await curfewCommand('indoor_only');
    curfew.phase='active';
   }else if(curfew.ownsLock&&(await readCurfewFlap())!=='locked'){
    // Someone manually changed the flap. Do not fight the manual override.
    curfew.ownsLock=false;curfew.phase='overridden';
   }
  }else{
   if(curfew.ownsLock){await curfewCommand('normal');curfew.ownsLock=false;}
   curfew.phase='waiting';
  }
  curfew.lastError='';saveCurfew();
 }catch(e){curfew.lastError=String(e.message||e).slice(0,180);saveCurfew();}
 finally{curfewBusy=false;}
}
setInterval(()=>curfewTick().catch(()=>{}),10000);
setTimeout(()=>curfewTick().catch(()=>{}),2000);


const petCurfewFile='/data/pet_curfews.json';
let petCurfewState={pets:{}};
try{const saved=JSON.parse(fs.readFileSync(petCurfewFile,'utf8'));if(saved&&saved.pets&&typeof saved.pets==='object')petCurfewState=saved;}catch{}
const savePetCurfews=()=>{fs.writeFileSync(petCurfewFile,JSON.stringify(petCurfewState),{mode:0o600});broadcastSse('curfew',{individual:true});};
const petCurfewEventFile='/data/pet_curfew_events.json';
let petCurfewEvents=[];
try{const saved=JSON.parse(fs.readFileSync(petCurfewEventFile,'utf8'));if(Array.isArray(saved))petCurfewEvents=saved.slice(-150);}catch{}
function logPetCurfew(id,event,detail=''){
 petCurfewEvents.push({at:new Date().toISOString(),petId:String(id),event,detail:String(detail).slice(0,200)});
 petCurfewEvents=petCurfewEvents.slice(-150);
 try{fs.writeFileSync(petCurfewEventFile,JSON.stringify(petCurfewEvents),{mode:0o600});}catch(e){console.error('Curfew event log failed:',e.message);}
}
let petCurfewBusy=false;
const validPetTime=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
function petCurfewActive(entry,date=new Date()){
 if(!entry.enabled)return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const fields=Object.fromEntries(parts.map(p=>[p.type,p.value])),days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],today=days.indexOf(fields.weekday);
 if(today<0)return false;
 const clock=fields.hour+':'+fields.minute,prev=(today+6)%7;
 const active=(d,previous)=>{if(!d||d.enabled===false||!validPetTime(d.start)||!validPetTime(d.end)||d.start===d.end)return false;return d.start<d.end?!previous&&clock>=d.start&&clock<d.end:previous?clock<d.end:clock>=d.start;};
 return active(entry.days[today],false)||active(entry.days[prev],true);
}
// All Sure Petcare traffic passes through one process-wide limiter and login cache.
// Do not create a new remote session on each scheduler/UI poll.
const sureDeviceId=randomUUID();
const sureTraffic={next:0,cooldown:0,queue:Promise.resolve(),login:new Map(),dashboard:null,permissionRead:null,permissionPending:null};
let activityHouseholdCache=null;
 let positionReadUnsupportedUntil=0;
const surePause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sureFetch(url,options={}){
 const enqueuedAt=Date.now();
 const endpoint=String(url);
 if(!endpoint.startsWith('https://app.api.surehub.io/api/'))throw Error('Unexpected Sure Petcare endpoint');
 const login=endpoint.endsWith('/auth/login'),dashboard=endpoint.endsWith('/me/start');
 const method=String(options.method||'GET').toUpperCase();
 const key=login?(()=>{try{const b=JSON.parse(options.body||'{}');return createHash('sha256').update(String(b.email_address||'')+'|'+String(b.password||'')).digest('hex');}catch{return String(options.body||'');}})():'';
 if(login){
  const prior=sureTraffic.login.get(key);
  if(prior&&Date.now()<prior.expires)return prior.response.clone();
 }
 if(dashboard&&method==='GET'&&sureTraffic.dashboard&&Date.now()<sureTraffic.dashboard.expires)return sureTraffic.dashboard.response.clone();
 const job=async()=>{
  if(login){const cached=sureTraffic.login.get(key);if(cached&&Date.now()<cached.expires)return cached.response.clone();}
  if(dashboard&&method==='GET'&&sureTraffic.dashboard&&Date.now()<sureTraffic.dashboard.expires)return sureTraffic.dashboard.response.clone();
  if(Date.now()<sureTraffic.cooldown){reliabilityDiagnostics.record('sure_cloud','cloud_request',enqueuedAt,{ok:false,error:'rate_limited'});throw Error('Sure Petcare rate limit active; requests paused');}
  const wait=Math.max(0,sureTraffic.next-Date.now());
  if(wait)await surePause(wait);
  if(Date.now()<sureTraffic.cooldown){reliabilityDiagnostics.record('sure_cloud','cloud_request',enqueuedAt,{ok:false,error:'rate_limited'});throw Error('Sure Petcare rate limit active; requests paused');}
  sureTraffic.next=Date.now()+3000;
  const networkStarted=Date.now();
  const queueMs=networkStarted-enqueuedAt;
  const {timeoutMs,...fetchOptions}=options;
  // Start the timeout when the queued request actually begins, not while it waits.
  if(timeoutMs)fetchOptions.signal=AbortSignal.timeout(timeoutMs);
  let response;
  try{response=await fetch(url,fetchOptions);}
  catch(e){
   const type=e?.name==='AbortError'||e?.name==='TimeoutError'?'timeout':'network';
   reliabilityDiagnostics.record('sure_cloud','cloud_request',enqueuedAt,{ok:false,error:type,queueMs,networkMs:Date.now()-networkStarted});
   throw e;
  }
  reliabilityDiagnostics.record('sure_cloud','cloud_request',enqueuedAt,{ok:response.ok,status:response.status,queueMs,networkMs:Date.now()-networkStarted,error:response.status===429?'rate_limited':response.status===401||response.status===403?'authentication':response.ok?null:'http_error'});
  if(response.status===429){
   const retry=Number(response.headers.get('retry-after'));
   sureTraffic.cooldown=Date.now()+(Number.isFinite(retry)&&retry>0?Math.min(retry*1000,900000):300000);
   sureTraffic.login.clear();sureTraffic.dashboard=null;
   return response;
  }
  if(response.status===401||response.status===403){sureTraffic.login.clear();sureTraffic.dashboard=null;}
  if(login&&response.ok)sureTraffic.login.set(key,{response:response.clone(),expires:Date.now()+10*60*1000});
  if(dashboard&&response.ok)sureTraffic.dashboard={response:response.clone(),expires:Date.now()+2000};
  if(method!=='GET'&&!login){sureTraffic.dashboard=null;sureTraffic.permissionRead=null;}
  return response;
 };
 const pending=sureTraffic.queue.then(job,job);
 sureTraffic.queue=pending.then(()=>{},()=>{});
 return pending;
}
async function surePetSession(){
 let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
 if(!options.sure_email||!options.sure_password)throw Error('Sure Petcare not configured');
 const deviceId=sureDeviceId,headers={'Content-Type':'application/json',Accept:'application/json',Origin:'https://surepetcare.io',Referer:'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
 const login=await sureFetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:options.sure_email,password:options.sure_password,device_id:deviceId}),timeoutMs:12000});
 if(!login.ok)throw Error('Sure Petcare login failed');
 const auth=await login.json(),access=auth.data?.token||auth.token||auth.access_token||auth.data?.access_token;
 if(!access)throw Error('Sure Petcare login token unavailable');
 headers.Authorization='Bearer '+access;
 const dashboard=async()=>{const r=await sureFetch('https://app.api.surehub.io/api/me/start',{headers,timeoutMs:12000});if(!r.ok)throw Error('Sure Petcare permission check failed');return (await r.json()).data||{};};
 const set=async(device,tag,profile)=>{
  const queuedAt=Date.now();
  try{
   const r=await sureFetch('https://app.api.surehub.io/api/device/'+device+'/tag/'+tag,{method:'PUT',headers,body:JSON.stringify({profile}),timeoutMs:12000});
   if(!r.ok)throw Error('Sure Petcare permission update returned HTTP '+r.status);
   console.log('Sure Petcare permission write accepted in '+(Date.now()-queuedAt)+'ms');
  }catch(err){
   const duration=Date.now()-queuedAt;
   const timedOut=err?.name==='TimeoutError'||err?.name==='AbortError';
   throw Error(timedOut?'Sure Petcare write timed out after '+duration+'ms; outcome unknown, check official app':String(err.message||err));
  }
 };
 return {dashboard,set};
}
function surePetMatch(data,petId){
 const pets=(data.pets||[]).filter(p=>String(p.id)===String(petId));
 if(pets.length!==1)throw Error('Cat not uniquely identified');
 const matches=(data.devices||[]).filter(d=>[6,13].includes(Number(d.product_id))).flatMap(d=>(d.tags||[]).filter(t=>String(t.id)===String(pets[0].tag_id)).map(t=>({device:d,tag:t})));
 if(matches.length!==1)throw Error('Flap tag not uniquely identified');
 const match=matches[0],device=Number(match.device.id),tag=Number(match.tag.tag_id??match.tag.id);
 if(!Number.isSafeInteger(device)||!Number.isSafeInteger(tag)||device<=0||tag<=0)throw Error('Invalid flap identifiers');
 return {device,tag,profile:Number(match.tag.profile)};
}
async function petCurfewTick(){
 if(petCurfewBusy||globalThis.petAccessBusy)return;
 const due=Object.entries(petCurfewState.pets).filter(([,e])=>e.enabled||e.owned);
 if(!due.length)return;
 petCurfewBusy=true;
 try{
  const sure=await surePetSession();
  // Each transition gets a fresh cloud snapshot. Never reuse the same snapshot
  // across writes to different cats: it can report an obsolete profile.
  for(const [id,entry] of due){
   try{
    const match=surePetMatch(await sure.dashboard(),id);
    const active=petCurfewActive(entry),now=Date.now();
    entry.lastChecked=new Date(now).toISOString();
    entry.lastObservedProfile=match.profile;
    entry.activeNow=active;
    if(entry.manual){entry.owned=false;entry.phase='manual';continue;}
    if(!active&&entry.owned){
     entry.phase='releasing';
     if(match.profile===2){
      // A cloud readback is not proof the physical flap has applied the command.
      entry.owned=false;entry.phase='free';
      entry.lastTransition=new Date().toISOString();entry.lastReleaseRequest=null;
      entry.lastError='';
      logPetCurfew(id,'automatic_release_cloud_reported','Free Access reported by Sure Petcare; physical flap not verified');
     }else if(match.profile===3){
      const last=Date.parse(entry.lastReleaseRequest||'');
      if(!Number.isFinite(last)||now-last>=30000){
       entry.lastReleaseRequest=new Date().toISOString();savePetCurfews();
       logPetCurfew(id,'automatic_release_requested','Requesting Free Access');
       await sure.set(match.device,match.tag,2);
       logPetCurfew(id,'automatic_release_accepted','Cloud accepted command; physical flap not verified');
      }
      entry.lastError='Awaiting Sure Petcare Free Access readback; physical flap not verified';
     }else throw Error('Unexpected cloud profile; manual verification required');
    }else if(active&&!entry.owned){
     if(match.profile!==2){entry.phase='external';entry.lastError='Existing restriction preserved; automatic curfew cannot take ownership';continue;}
     entry.owned=true;entry.phase='applying';entry.lastTransition=new Date().toISOString();
     savePetCurfews();logPetCurfew(id,'automatic_start_requested','Requesting Indoor Only');
     await sure.set(match.device,match.tag,3);
     logPetCurfew(id,'automatic_start_accepted','Cloud accepted command; physical flap not verified');
     entry.lastError='Awaiting Indoor Only readback; physical flap not verified';
    }else if(active&&entry.owned){
     if(match.profile===3){
      entry.phase='curfew';entry.lastError='';
     }else if(match.profile===2){
      // Preserve ownership until the end time. Never abandon release responsibility
      // because an asynchronous cloud snapshot disagrees with the start write.
      entry.phase='applying';
      const since=now-Date.parse(entry.lastTransition||'');
      if(Number.isFinite(since)&&since>=30000){
       entry.lastError='Indoor Only not confirmed by Sure Petcare; check flap manually';
      }else entry.lastError='Awaiting Indoor Only cloud readback';
     }else throw Error('Unexpected cloud profile during curfew');
    }else{
     entry.phase='free';entry.lastError='';
    }
   }catch(err){
    entry.lastError=String(err.message||err).slice(0,160);
    logPetCurfew(id,'scheduler_error',entry.lastError);
   }
  }
  savePetCurfews();
 }catch(err){
  for(const [,entry] of due)entry.lastError=String(err.message||err).slice(0,160);
  savePetCurfews();
 }finally{petCurfewBusy=false;}
}
setInterval(()=>petCurfewTick().catch(()=>{}),10000);
setTimeout(()=>petCurfewTick().catch(()=>{}),3500);

const handleRequest=async(req,res,standaloneRequest=false)=>{
  const peer=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  let verifiedEmail=null;
  if(standaloneRequest){
    if(!verifyStandalone){res.writeHead(403);return res.end();}
    try{verifiedEmail=(await verifyStandalone(req.headers['cf-access-jwt-assertion'])).email;}
    catch{res.writeHead(403,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end('Access denied');}
  }else if(peer!=='172.30.32.2'){res.writeHead(403);return res.end();}
  const url=new URL(req.url,'http://localhost');

  if(url.pathname==='/live/stream'&&req.method==='GET'){
    res.writeHead(200,{
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-store',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    });
    sseClients.add(res);
    req.on('close',()=>sseClients.delete(res));
    if(liveEntityCache.size){
      res.write('event: status\ndata: '+JSON.stringify(buildStatusSnapshot())+'\n\n');
      if(liveEntityCache.has('lock.my_flap_locked_out')){
        res.write('event: flap\ndata: '+JSON.stringify(buildFlapSnapshot())+'\n\n');
      }
    }
    return;
  }

  if(url.pathname==='/pet-hq/release-info'&&req.method==='GET'){
    try{
      const configuration=fs.readFileSync('/app/config.yaml','utf8');
      const match=configuration.match(/^version:\s*["']?([0-9.]+)["']?\s*$/m);
      if(!match)throw Error('Add-on version missing');
      const changelog=fs.readFileSync('/app/CHANGELOG.md','utf8');
      const sections=changelog.split(/^##\s+/m).slice(1);
      const latest=sections.find(section=>section.startsWith('v'+match[1]+' '));
      const notes=latest?latest.slice(latest.indexOf('\n')+1).trim():'Release notes unavailable for this version.';
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({version:match[1],notes}));
    }catch(e){
      res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({error:'Release information unavailable'}));
    }
  }

  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');

  if(url.pathname==='/pet-hq/family'&&(req.method==='GET'||req.method==='POST')){
   const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
   if(!standaloneRequest)return reply(403,{error:'Manage family members through the signed-in Pet HQ app'});
   if(!verifiedEmail||!emailAllowed(verifiedEmail))return reply(403,{error:'Not authorised'});
   if(req.method==='GET')return reply(200,{members:family.members,viewer:verifiedEmail});
   try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return reply(413,{error:'Request too large'});}
    const body=JSON.parse(raw),email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>120)return reply(400,{error:'Valid email required'});
    if(body.action==='add'){
     if(!name||name.length>60)return reply(400,{error:'Name required'});
     if(family.members.some(m=>m.email===email))return reply(409,{error:'Email already registered'});
     family.members.push({email,name,primary:false,addedAt:new Date().toISOString()});
    }else if(body.action==='remove'){
     const existing=family.members.find(m=>m.email===email);
     if(!existing)return reply(404,{error:'Member not found'});
     if(existing.primary)return reply(403,{error:'Primary household members are protected'});
     if(family.members.length<=1)return reply(409,{error:'Cannot remove last member'});
     family.members=family.members.filter(m=>m.email!==email);
    }else return reply(400,{error:'Invalid action'});
    saveFamily();return reply(200,{members:family.members,viewer:verifiedEmail});
   }catch(e){return reply(500,{error:'Family update failed: '+e.message});}
  }
  if(url.pathname==='/pet-hq/archive'&&(req.method==='GET'||req.method==='POST')){
   const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(body));};
   if(req.method==='GET')return reply(200,{version:1,pets:petArchive.pets});
   try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)return reply(413,{error:'Archive request too large'});}
    const body=JSON.parse(raw),id=String(body.surePetId||'');
    if(!/^\d{1,20}$/.test(id))return reply(400,{error:'A valid Sure Petcare pet ID is required'});
    if(body.action==='archive'){
     const profile=body.profile;
     if(!profile||String(profile.surePetId)!==id||typeof profile.name!=='string'||profile.name.length>100)return reply(400,{error:'Valid pet profile required'});
     const previous=petArchive.pets[id];
     petArchive.pets[id]={...previous,surePetId:id,name:profile.name,profile,events:Array.isArray(body.events)?body.events.slice(0,3000):previous?.events||[],archivedAt:new Date().toISOString()};
    }else if(body.action==='restore'){
     if(!petArchive.pets[id])return reply(404,{error:'Archived cat not found'});
     delete petArchive.pets[id];
    }else return reply(400,{error:'Unknown archive action'});
    writePetArchive();
    return reply(200,{version:1,pets:petArchive.pets});
   }catch(e){return reply(500,{error:'Could not save archive: '+e.message});}
  }
  // Read-only local timings; no new cloud calls and no credentials or pet identifiers.
  if(url.pathname==='/pet-hq/usb-archive'&&req.method==='GET'){
   syncUsbArchive();
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
   return res.end(JSON.stringify({name:'Pet_HQ_Logs',...usbArchiveState,mode:'additional copy; original data retained internally',intervalSeconds:60}));
  }
  if(url.pathname==='/pet-hq/reliability'&&req.method==='GET'){
   const download=url.searchParams.get('download')==='1';
   const snapshot=reliabilityDiagnostics.snapshot(download);
   if(download){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8
