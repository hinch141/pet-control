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
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="pet-hq-reliability.json"'});
    return res.end(JSON.stringify(snapshot));
   }
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
   return res.end(JSON.stringify(snapshot));
  }
  if(url.pathname==='/live/flap/curfew'&&(req.method==='GET'||req.method==='POST')){
   const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
   if(req.method==='GET')return reply(200,{...curfew,now:londonDateTime()});
   if(curfewBusy)return reply(409,{error:'Curfew transition in progress. Please retry.'});
   try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return reply(413,{error:'Request too large'});}
    const body=JSON.parse(raw);
    if(body.action==='disable'){
     curfew.enabled=false;curfew.phase='off';saveCurfew();
     // Explicit cancellation requests Free Access, even if a prior command was not confirmed.
     // This avoids leaving the flap locked after a partially successful curfew start.
     if((await readCurfewFlap())==='locked'){
      curfewBusy=true;
      try{await curfewCommand('normal');curfew.ownsLock=false;curfew.lastError='';saveCurfew();}
      catch(e){curfew.lastError='Curfew disabled but unlock not confirmed: '+e.message;saveCurfew();return reply(502,{error:curfew.lastError});}
      finally{curfewBusy=false;}
     }
     return reply(200,curfew);
    }
    const validTime=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    if(!['enable','save'].includes(body.action)||!Array.isArray(body.ranges)||body.ranges.length<1||body.ranges.length>12)return reply(400,{error:'Add between 1 and 12 time ranges.'});
    const ranges=body.ranges.map(r=>({start:r.start,end:r.end}));
    if(ranges.some(r=>!validTime(r.start)||!validTime(r.end)||r.start===r.end))return reply(400,{error:'Each range needs different valid start and end times.'});
    const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
    const spans=ranges.flatMap(r=>{const a=minutes(r.start),b=minutes(r.end);return a<b?[[a,b]]:[[a,1440],[0,b]];}).sort((a,b)=>a[0]-b[0]);
    if(spans.some((x,i)=>i>0&&x[0]<spans[i-1][1]))return reply(400,{error:'Curfew ranges must not overlap.'});
    if(curfew.enabled||curfew.ownsLock)return reply(409,{error:'Turn off the current curfew before changing its ranges.'});
    curfew={enabled:body.action==='enable',ranges,phase:body.action==='enable'?'waiting':'off',ownsLock:false,lastError:'',override:false};
    saveCurfew();if(curfew.enabled)setImmediate(()=>curfewTick().catch(()=>{}));return reply(200,curfew);
   }catch(e){return reply(400,{error:'Unable to save curfew: '+e.message});}
  }
  if(url.pathname==='/live/flap/mode'&&req.method==='POST'){
    const commandDiagnosticStart=Date.now();
    if(curfew.enabled)return (res.writeHead(409,{'Content-Type':'application/json'}),res.end(JSON.stringify({error:'Disable the scheduled curfew before using manual control.'})));
    if(!curfew.enabled&&curfew.ownsLock){curfew.ownsLock=false;saveCurfew();}
    const reply=(code,body)=>{reliabilityDiagnostics.record('home_assistant','house_lock_command',commandDiagnosticStart,{ok:code===200&&body?.status==='confirmed',status:code,error:code===200&&body?.status==='confirmed'?null:'not_confirmed'});res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    if(!token)return reply(503,{error:'Home Assistant connection unavailable'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'JSON required'});
    try{
      let raw='';
      for await(const chunk of req){raw+=chunk;if(raw.length>512)return reply(413,{error:'Request too large'});}
      const body=JSON.parse(raw),mode=body.mode;
      if(mode!=='normal'&&mode!=='indoor_only')return reply(400,{error:'Invalid mode'});
      const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
      const entity='lock.my_flap_locked_out';
      const before=await fetch('http://supervisor/core/api/states/'+entity,{headers,signal:AbortSignal.timeout(6000)});
      if(!before.ok)return reply(502,{error:'Unable to check current flap state'});
      const current=String((await before.json()).state);
      if(current!=='locked'&&current!=='unlocked')return reply(409,{error:'Flap state unknown; no command sent'});
      const desired=mode==='indoor_only'?'locked':'unlocked';
      if(current!==desired){
        const action=mode==='indoor_only'?'lock':'unlock';
        const call=await fetch('http://supervisor/core/api/services/lock/'+action,{
          method:'POST',headers,body:JSON.stringify({entity_id:entity}),signal:AbortSignal.timeout(8000)});
        if(!call.ok)return reply(502,{error:'Home Assistant did not accept the command'});
      }
      // A successful service call alone does not establish the physical flap state.
      for(let attempt=0;attempt<3;attempt++){
        const check=await fetch('http://supervisor/core/api/states/'+entity,{headers,signal:AbortSignal.timeout(6000)});
        if(check.ok){
          const actual=String((await check.json()).state);
          if(actual===desired)return reply(200,{status:'confirmed',mode,state:actual});
        }
        if(attempt<2)await new Promise(resolve=>setTimeout(resolve,900));
      }
      return reply(202,{status:'pending',message:'Command sent, but the flap state has not yet been confirmed'});
    }catch{return reply(502,{error:'Unable to confirm flap command. Check Home Assistant.'});}
  }
  if(url.pathname==='/sure/pet-curfews/bulk-disable'&&req.method==='POST'){
   const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
   if(petCurfewBusy||globalThis.petAccessBusy)return reply(409,{error:'Cat access update in progress'});
   let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>256)return reply(413,{error:'Request too large'});}
    const body=JSON.parse(raw);if(body.confirm!=='DISABLE_ALL_INDIVIDUAL_CURFEWS')return reply(400,{error:'Confirmation required'});
    const ids=Object.keys(petCurfewState.pets).filter(id=>petCurfewState.pets[id].enabled);
    for(const id of ids)petCurfewState.pets[id].enabled=false;
    savePetCurfews();setImmediate(()=>petCurfewTick().catch(()=>{}));
    return reply(200,{disabled:ids.length,manualRestrictionsPreserved:true});
   }catch(e){return reply(400,{error:String(e.message||e)});}
  }
  if(url.pathname==='/sure/pet-curfew-events'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
   return res.end(JSON.stringify({events:petCurfewEvents.slice(-80)}));
  }
  if(url.pathname==='/sure/pet-curfews'&&(req.method==='GET'||req.method==='POST')){
   const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
   if(req.method==='GET')return reply(200,{pets:petCurfewState.pets,now:londonDateTime()});
   if(petCurfewBusy||globalThis.petAccessBusy)return reply(409,{error:'A cat permission update is in progress. Retry shortly.'});
   try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)return reply(413,{error:'Schedule too large'});}
    const body=JSON.parse(raw),id=String(body.petId||'');
    if(!/^[0-9]+$/.test(id)||typeof body.enabled!=='boolean'||!Array.isArray(body.days)||body.days.length!==7)return reply(400,{error:'Invalid cat or weekly schedule'});
    const days=body.days.map(d=>({enabled:d.enabled===true,start:d.start,end:d.end}));
    if(days.some(d=>d.enabled&&(!validPetTime(d.start)||!validPetTime(d.end)||d.start===d.end)))return reply(400,{error:'Enabled curfew days need valid, different start and end times'});
    const old=petCurfewState.pets[id]||{manual:false,owned:false};
    // A manual restriction remains authoritative, including when schedules are edited.
    petCurfewState.pets[id]={...old,enabled:body.enabled,days,lastError:''};
    savePetCurfews();setImmediate(()=>petCurfewTick().catch(()=>{}));
    return reply(200,{petId:id,...petCurfewState.pets[id]});
   }catch(err){return reply(400,{error:String(err.message||err)});}
  }
  if(url.pathname==='/sure/pet-access'&&req.method==='POST'){
   const commandDiagnosticStart=Date.now();
   sureTraffic.lastInteractive=Date.now();
   const reply=(code,body)=>{reliabilityDiagnostics.record('sure_cloud','individual_access_command',commandDiagnosticStart,{ok:code>=200&&code<300,status:code,error:code>=200&&code<300?null:'not_confirmed'});res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
   try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>512)return reply(413,{error:'Request too large'});}
    const body=JSON.parse(raw);
    if(!/^[0-9]+$/.test(String(body.petId||''))||!['free_access','indoor_only'].includes(body.mode))return reply(400,{error:'Invalid cat or access mode'});
    if(globalThis.petAccessBusy||petCurfewBusy)return reply(409,{error:'A cat access or curfew change is in progress'});
    globalThis.petAccessBusy=true;
    let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    if(!options.sure_email||!options.sure_password)return reply(503,{error:'Sure Petcare credentials missing'});
    const deviceId=sureDeviceId,headers={'Content-Type':'application/json',Accept:'application/json',Origin:'https://surepetcare.io',Referer:'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
    const login=await sureFetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:options.sure_email,password:options.sure_password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
    if(!login.ok)throw Error('Sure Petcare login failed');
    const auth=await login.json();headers.Authorization='Bearer '+(auth.data?.token||auth.token||auth.access_token||auth.data?.access_token||'');
    const dashboard=async()=>{const resp=await sureFetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});if(!resp.ok)throw Error('Unable to read current permissions');return (await resp.json()).data||{};};
    const data=await dashboard(),pets=(data.pets||[]).filter(p=>String(p.id)===String(body.petId));
    if(pets.length!==1)throw Error('Cat could not be uniquely identified');
    const matches=(data.devices||[]).filter(d=>[6,13].includes(Number(d.product_id))).flatMap(d=>(d.tags||[]).filter(t=>String(t.id)===String(pets[0].tag_id)).map(t=>({device:d,tag:t})));
    if(matches.length!==1)throw Error('Cat flap tag could not be uniquely identified');
    const chosen=matches[0],current=Number(chosen.tag.profile),desired=body.mode==='indoor_only'?3:2;
    if(![2,3].includes(current))throw Error('Unsupported current permission; no change made');
    if(current!==desired){
     const id=Number(chosen.device.id),tag=Number(chosen.tag.tag_id??chosen.tag.id);
     if(!Number.isSafeInteger(id)||!Number.isSafeInteger(tag)||id<=0||tag<=0)throw Error('Invalid device or tag');
     const resp=await sureFetch('https://app.api.surehub.io/api/device/'+id+'/tag/'+tag,{method:'PUT',headers,body:JSON.stringify({profile:desired}),signal:AbortSignal.timeout(12000)});
     if(!resp.ok)throw Error('Sure Petcare rejected the permission change');
    }
    let confirmed=current===desired;
    for(let attempt=0;!confirmed&&attempt<6;attempt++){
     await new Promise(resolve=>setTimeout(resolve,2000));
     const check=await dashboard();
     const tags=(check.devices||[]).filter(d=>[6,13].includes(Number(d.product_id))).flatMap(d=>(d.tags||[]).filter(t=>String(t.id)===String(pets[0].tag_id)));
     confirmed=tags.length===1&&Number(tags[0].profile)===desired;
    }
    const entry=petCurfewState.pets[String(body.petId)]||{enabled:false,days:[],owned:false,manual:false};
    // Explicit manual Indoor Only always wins; explicit Free Access clears manual hold.
    logPetCurfew(body.petId,'manual_access_requested',body.mode+(confirmed?' confirmed':' pending confirmation'));entry.manual=body.mode==='indoor_only';
    entry.owned=false;
    petCurfewState.pets[String(body.petId)]=entry;savePetCurfews();
    return reply(200,{status:confirmed?'confirmed':'pending',mode:body.mode,name:pets[0].name});
   }catch(e){return reply(502,{error:String(e.message||'Unable to change access').slice(0,160)});}
   finally{globalThis.petAccessBusy=false;}
  }
  if(url.pathname==='/sure/pet-permission-test'&&req.method==='POST'){
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(body));};
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'JSON required'});
    let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>256)return reply(413,{error:'Request too large'});}}catch{return reply(400,{error:'Invalid request'});}
    let request;try{request=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
    if(request.pet!=='Jessie'||request.confirm!=='TEST_JESSIE_AND_RESTORE')return reply(400,{error:'Only the explicitly confirmed Jessie test is available'});
    if(globalThis.petPermissionTestBusy)return reply(409,{error:'A test is already running'});
    globalThis.petPermissionTestBusy=true;
    let restore=null,stage='checking',beforeProfiles=null,readProfiles=null,readDashboard=null,writeAttempted=false,writeHttpStatus=null;
    try{
      let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
      const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
      if(!email||!password)return reply(503,{error:'Sure Petcare is not configured'});
      const deviceId=sureDeviceId;
      const headers={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const login=await sureFetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)throw Error('Sure Petcare login failed');
      const auth=await login.json(),access=auth.data?.token||auth.token||auth.access_token||auth.data?.access_token;
      if(typeof access!=='string'||!access)throw Error('Sure Petcare token unavailable');
      headers.Authorization='Bearer '+access;
      const dashboard=async()=>{
        const response=await sureFetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw Error('Unable to verify individual permissions');
        return (await response.json()).data||{};
      };
      readDashboard=dashboard;
      const initial=await dashboard();
      const flaps=(Array.isArray(initial.devices)?initial.devices:[]).filter(d=>[6,13].includes(Number(d.product_id)));
      const cats=Array.isArray(initial.pets)?initial.pets:[];
      const jessies=cats.filter(p=>String(p.name||'').trim().toLowerCase()==='jessie');
      if(jessies.length!==1)throw Error('Jessie cannot be uniquely identified');
      const matches=flaps.flatMap(d=>(Array.isArray(d.tags)?d.tags:[]).filter(t=>String(t.id)===String(jessies[0].tag_id)).map(t=>({device:d,tag:t})));
      if(matches.length!==1)throw Error('Jessie does not have one unique flap tag');
      const chosen=matches[0],original=Number(chosen.tag.profile);
      if(original!==2)throw Error('Jessie must start with verified Free Access (profile 2)');
      const device=Number(chosen.device.id),tag=Number(chosen.tag.tag_id??chosen.tag.id);
      if(!Number.isSafeInteger(device)||!Number.isSafeInteger(tag)||device<=0||tag<=0)throw Error('Invalid flap tag identifiers');
      const url='https://app.api.surehub.io/api/device/'+device+'/tag/'+tag;
      const setProfile=async profile=>{
        const response=await sureFetch(url,{method:'PUT',headers,body:JSON.stringify({profile}),signal:AbortSignal.timeout(12000)});
        writeHttpStatus=response.status;
        if(!response.ok)throw Error('Sure Petcare rejected profile update (HTTP '+response.status+')');
      };
      // Arm restoration before the first write: even a timed-out PUT may have been applied.
      restore=()=>setProfile(2);
      stage='restricting';
      writeAttempted=true;
      await setProfile(3);
      const profiles=data=>(Array.isArray(data.pets)?data.pets:[]).map(p=>{
        const ms=(Array.isArray(data.devices)?data.devices:[]).filter(d=>[6,13].includes(Number(d.product_id))).flatMap(d=>(Array.isArray(d.tags)?d.tags:[]).filter(t=>String(t.id)===String(p.tag_id)));
        return {name:String(p.name||''),profile:ms.length===1?Number(ms[0].profile):null};
      });
      readProfiles=profiles;
      beforeProfiles=profiles(initial);
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const getJessie=rows=>rows.filter(p=>p.name.trim().toLowerCase()==='jessie');
      // The Sure Petcare dashboard can report an old value immediately after a write.
      // Require two consecutive fresh confirmations, separated by several seconds.
      stage='verifying_indoor_only';
      let during=[],restrictedConfirmed=false,unchanged=false,restrictedStreak=0;
      for(let attempt=0;attempt<6;attempt++){
        await sleep(3000);
        during=profiles(await dashboard());
        unchanged=beforeProfiles.filter(p=>p.name.toLowerCase()!=='jessie').every(p=>during.some(q=>q.name===p.name&&q.profile===p.profile));
        const js=getJessie(during);
        restrictedStreak=js.length===1&&js[0].profile===3?restrictedStreak+1:0;
        if(restrictedStreak>=2){restrictedConfirmed=true;break;}
      }
      stage='restoring';
      await restore();
      stage='verifying_restored';
      let after=[],restored=false,freeStreak=0,restoreRetries=0;
      // Never accept an immediate cached Free Access result as successful restoration.
      // Continue checking for delayed application of the earlier Indoor Only command.
      for(let attempt=0;attempt<10;attempt++){
        await sleep(4000);
        try{
          after=profiles(await dashboard());
          const js=getJessie(after);
          if(js.length!==1)throw Error('Jessie missing from verification');
          if(js[0].profile===3&&(attempt===3||attempt===6)){
            stage='retrying_restore';restoreRetries++;await restore();stage='verifying_restored';freeStreak=0;continue;
          }
          freeStreak=js[0].profile===2?freeStreak+1:0;
          if(freeStreak>=2&&attempt>=5){restored=true;break;}
        }catch(err){if(attempt===9)throw err;freeStreak=0;}
      }
      if(restored)restore=null;
      return reply(200,{status:restrictedConfirmed&&unchanged&&restored?'passed':'needs_review',restrictedConfirmed,otherCatsUnchanged:unchanged,restored,restoreRetries,initial:beforeProfiles,during,after,message:restored?(restrictedConfirmed&&unchanged?'Full electronic test passed; Jessie returned to Free Access after delayed checks.':'Jessie returned to Free Access after delayed checks, but the restriction or other-cat checks were inconclusive.'):'Jessie restoration is NOT confirmed. Check Sure Petcare immediately.'});
    }catch(e){
      let restoreAccepted=false,restoredConfirmed=false,restoreError=null;
      if(restore){
        try{stage=stage==='restricting'?'restricting_then_restoring':stage;await restore();restoreAccepted=true;}
        catch(err){restoreError=String(err?.message||'Restore request failed').slice(0,120);}
        if(readDashboard&&readProfiles){
          for(let attempt=0;attempt<4;attempt++){
            try{
              if(attempt)await new Promise(resolve=>setTimeout(resolve,1200));
              const profiles=readProfiles(await readDashboard());
              if(profiles.some(p=>p.name.toLowerCase()==='jessie'&&p.profile===2)){restoredConfirmed=true;break;}
            }catch{}
          }
        }
      }
      const cause=String(e?.message||'Unknown error').slice(0,140);
      const message=restoredConfirmed?'Jessie is confirmed back on Free Access. Test failed at '+stage+'.':restoreAccepted?'Restore command accepted, but confirmation is pending. Check Jessie’s access.':writeAttempted?'Restore is not confirmed. Check Jessie’s permission in Sure Petcare immediately.':'No change command was sent. Test stopped before changing Jessie.';
      return reply(200,{status:'error',stage,cause,writeAttempted,writeHttpStatus,restoreAccepted,restoredConfirmed,restoreError,message});
    }finally{globalThis.petPermissionTestBusy=false;}
  }
  if(url.pathname==='/sure/locations'&&(req.method==='GET'||req.method==='POST')){
    const diagnosticStart=Date.now();
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(body));};
    let body=null;
    if(req.method==='POST'){
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'JSON required'});
      let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>512)return reply(413,{error:'Request too large'});}body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
      if(!['inside','outside'].includes(body?.location)||!/^\d+$/.test(String(body?.petId||'')))return reply(400,{error:'Invalid pet or location'});
    }
    // GET position reads are unsupported (HTTP 405); bypass the cloud queue.
    // POST manual position changes are unaffected.
    if(req.method==='GET')return reply(200,{status:'position_reads_unavailable',pets:[],updated:new Date().toISOString()});
    let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
    if(!email||!password)return reply(503,{error:'Sure Petcare credentials not configured'});
    try{
      const headers={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':sureDeviceId};
      const login=await sureFetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:headers['X-Device-Id']}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)throw Error('Sure Petcare login failed');
      const auth=await login.json(),access=auth.data?.token||auth.token||auth.access_token||auth.data?.access_token;
      if(!access)throw Error('Authentication token missing');
      headers.Authorization='Bearer '+access;
      const dashboard=await sureFetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
      if(!dashboard.ok)throw Error('Unable to identify pets');
      const cats=(await dashboard.json()).data?.pets||[];
      if(!Array.isArray(cats))throw Error('Invalid pet list');
      if(body){
        const matches=cats.filter(p=>String(p.id)===String(body.petId));
        if(matches.length!==1) return reply(404,{error:'Pet not found in Sure Petcare'});
        const where=body.location==='inside'?1:2;
        const result=await sureFetch('https://app.api.surehub.io/api/pet/'+encodeURIComponent(body.petId)+'/position',{method:'POST',headers,body:JSON.stringify({where,since:new Date().toISOString()}),signal:AbortSignal.timeout(12000)});
        if(!result.ok)return reply(502,{error:'Sure Petcare rejected the location change (HTTP '+result.status+')'});
        return reply(200,{status:'accepted',petId:String(body.petId),location:body.location,message:'Sure Petcare accepted the change; waiting for a fresh read.'});
      }
      }catch(e){reliabilityDiagnostics.record('sure_cloud','positions',diagnosticStart,{ok:false,status:502,error:'request_failed'});return reply(502,{error:String(e.message||'Sure Petcare unavailable').slice(0,140)});}
  }
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(url.pathname==='/live/flap'){
    const diagnosticStart=Date.now();
    if(haWsConnected&&liveEntityCache.has('lock.my_flap_locked_out')){
      const snap=buildFlapSnapshot();
      reliabilityDiagnostics.record('home_assistant','flap_state',diagnosticStart,{ok:true,status:200,sourceUpdatedAt:snap.updated});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify(snap));
    }
    if(!token){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({status:'unavailable'}));}
    try{
      const response=await fetch('http://supervisor/core/api/states/lock.my_flap_locked_out',{
        headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw Error('HA state request failed');
      const data=await response.json();
      applyHaEntityState(data);
      const state=String(data.state||'unknown');
      const status=state==='locked'?'indoor_only':state==='unlocked'?'normal':'unknown';
      reliabilityDiagnostics.record('home_assistant','flap_state',diagnosticStart,{ok:true,status:200,sourceUpdatedAt:data.last_updated});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({entity_id:'lock.my_flap_locked_out',state,status,updated:data.last_updated||null}));
    }catch{
      reliabilityDiagnostics.record('home_assistant','flap_state',diagnosticStart,{ok:false,status:502,error:'read_failed'});
      res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({status:'unavailable'}));
    }
  }
  // Read-only discovery of per-cat tag profiles. Never changes any flap or tag.
  if(url.pathname==='/sure/pet-permissions'){
    sureTraffic.lastInteractive=Date.now();
    if(sureTraffic.permissionRead&&Date.now()<sureTraffic.permissionRead.expires){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(sureTraffic.permissionRead.body));}
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(body));};
    let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
    if(!email||!password)return reply(200,{status:'not_configured',message:'Sure Petcare credentials are not configured.'});
    try{
      const deviceId=sureDeviceId;
      const headers={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const login=await sureFetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)return reply(200,{status:'login_failed',message:'Sure Petcare authentication failed (HTTP '+login.status+').'});
      const auth=await login.json();
      const access=auth.data?.token||auth.token||auth.access_token||auth.data?.access_token;
      if(typeof access!=='string'||!access)return reply(200,{status:'unknown_login_format',message:'Unable to read Sure Petcare authentication response.'});
      const response=await sureFetch('https://app.api.surehub.io/api/me/start',{headers:{...headers,Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
      if(!response.ok)return reply(200,{status:'dashboard_failed',message:'Sure Petcare dashboard returned HTTP '+response.status+'.'});
      const data=(await response.json()).data||{};
      const devices=Array.isArray(data.devices)?data.devices:[];
      const animals=Array.isArray(data.pets)?data.pets:[];
      const flaps=devices.filter(d=>[3,6,13].includes(Number(d.product_id)));
      const cats=animals.map(p=>{
        const matches=flaps.flatMap(d=>(Array.isArray(d.tags)?d.tags:[]).filter(t=>String(t.id)===String(p.tag_id)).map(t=>({device:d,tag:t})));
        const match=matches.length===1?matches[0]:null;
        const profile=match?Number(match.tag.profile):null;
        return {surePetId:String(p.id??''),sureTagId:String(p.tag_id??''),name:String(p.name||'Unnamed cat').slice(0,60),matched:!!match,ambiguous:matches.length>1,profile:profile===2?'free_access':profile===3?'indoor_only':profile===0?'keep_current':'unknown',entry_safe_profile_known:profile===2||profile===3};
      });
      const result={status:'read_only',cats,flap_count:flaps.length,message:'Read-only discovery complete. No flap or pet permissions changed. Physical behaviour and write permissions are not yet verified.'};sureTraffic.permissionRead={body:result,expires:Date.now()+20000};return reply(200,result);
    }catch(err){const msg=String(err?.message||err);const reason=msg.includes('rate limit')?'rate_limited':err?.name==='TimeoutError'||err?.name==='AbortError'?'timeout':msg.includes('fetch failed')?'network_error':'request_error';return reply(200,{status:'connection_error',reason,message:reason==='rate_limited'?'Sure Petcare rate limit active. Requests are paused; please wait before checking again.':reason==='timeout'?'Sure Petcare request timed out; no permission was changed.':reason==='network_error'?'Unable to reach Sure Petcare; no permission was changed.':'Unable to retrieve individual cat permissions from Sure Petcare. No permission was changed.'});}
  }
  if(url.pathname==='/sure/diagnostic'){
    let options={};
    try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
    const output=(status,detail)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({status,detail}));};
    if(!email||!password)return output('not_configured','Add Sure Petcare email and password in the Pet Control app Configuration tab.');
    try{
      const deviceId=sureDeviceId;
      const baseHeaders={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const login=await sureFetch('https://app.api.surehub.io/api/auth/login',{
        method:'POST',headers:baseHeaders,
        body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)return output('login_failed','Sure Petcare authentication returned HTTP '+login.status+'. No credentials were logged.');
      const auth=await login.json();
      const access=auth.token||auth.access_token||auth.data?.token||auth.data?.access_token;
      if(typeof access!=='string'||!access)return output('unknown_login_format','Authentication returned an unexpected token format.');
      const headers={...baseHeaders,Authorization:'Bearer '+access};
      const start=await sureFetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
      if(!start.ok)return output('household_failed','Authenticated, but household lookup returned HTTP '+start.status+'.');
      const household=await start.json();
      const households=household.data?.households||household.data?.household||household.households||[];
      const first=Array.isArray(households)?households[0]:households;
      const householdId=first?.id||household.data?.household_id||household.data?.household?.id;
      if(!householdId)return output('login_connected','Authentication works. Household response structure needs adapting for timeline.');
      const endpoint='https://app.api.surehub.io/api/timeline/household/'+encodeURIComponent(householdId)+'?page=0';
      const timeline=await sureFetch(endpoint,{headers,signal:AbortSignal.timeout(12000)});
      if(!timeline.ok)return output('timeline_failed','Sure Petcare timeline returned HTTP '+timeline.status+'.');
      const payload=await timeline.json();
      const entries=Array.isArray(payload)?payload:Array.isArray(payload.data)?payload.data:Array.isArray(payload.data?.entries)?payload.data.entries:null;
      if(!entries)return output('unknown_timeline_format','Timeline response received but its structure needs adapting.');
      const types={};
      for(const e of entries){const type=String(e.type??e.data?.type??'unknown');types[type]=(types[type]||0)+1;}
      const sample=Object.create(null);
      for(const e of entries){
        const type=String(e.type??e.data?.type??'unknown');
        if(sample[type])continue;
        const data=e&&typeof e==='object'?e:{};
        sample[type]={fields:Object.keys(data).filter(k=>!['households','devices','users'].includes(k)),dataFields:data.data&&typeof data.data==='object'?Object.keys(data.data).slice(0,20):[],petFieldShape:Array.isArray(data.pets)?'array '+data.pets.length:typeof data.pets,petFields:Array.isArray(data.pets)&&data.pets[0]&&typeof data.pets[0]==='object'?Object.keys(data.pets[0]):[],deviceFieldShape:Array.isArray(data.devices)?'array '+data.devices.length:typeof data.devices,timestampField:['created_at','timestamp','date','time','created','event_time'].find(k=>k in data)||null};
      }
      return output('timeline_connected',{received:entries.length,eventTypes:types,eventStructure:sample,source:'Sure Petcare cloud; field names only, no event contents or credentials returned'});
    }catch(e){return output('connection_error','Unable to reach Sure Petcare or parse its response.');}
  }
  if(url.pathname==='/sure/archive'){
    let events=[];try{events=JSON.parse(fs.readFileSync('/data/sure-activity-cache.json','utf8'));if(!Array.isArray(events))events=[];}catch{}
    const date=url.searchParams.get('date');
    if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date))events=events.filter(e=>(()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(e.at)).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;})()===date);
    if(url.searchParams.get('format')==='csv'){
      const q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
      const lines=['Time (UTC),Pet,Movement'];
      for(const e of events)for(const pet of e.pets||[])lines.push([e.at,pet,e.type===0&&Number(e.details?.direction)===1?'In':e.type===0&&Number(e.details?.direction)===2?'Out':'Other'].map(q).join(','));
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="pet-control-history.csv"'});return res.end(lines.join('\r\n'));
    }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',...(url.searchParams.get('download')==='1'?{'Content-Disposition':'attachment; filename="pet-control-history.json"'}:{})});
    return res.end(JSON.stringify({events,total:events.length}));
  }
  if(url.pathname==='/sure/activity'){
    sureTraffic.lastInteractive=Date.now();
    const diagnosticStart=Date.now();
    const send=(status,detail)=>{reliabilityDiagnostics.record('sure_cloud','activity',diagnosticStart,{ok:status==='connected'||status==='connected_no_cache',status:200,sourceUpdatedAt:detail.events?.[0]?.at||null,error:status.startsWith('connected')?null:status});res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({status,...detail}));};
    if(activitySnapshot&&Date.now()-activitySnapshot.at<30000)return send(activitySnapshot.status,activitySnapshot.detail);
    let opts={};try{opts=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(opts.sure_email||'').trim(),password=String(opts.sure_password||'');
    if(!email||!password)return send('not_configured',{events:[],total:0});
    try{
      const deviceId=sureDeviceId;
      const headers={'Accept':'application/json','Content-Type':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const authRes=await sureFetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!authRes.ok)return send('authentication_error',{events:[],total:0});
      const auth=await authRes.json();const access=auth.data?.token||auth.token;
      if(!access)return send('authentication_error',{events:[],total:0});
      headers.Authorization='Bearer '+access;
      let houseId,home;
      if(activityHouseholdCache&&Date.now()<activityHouseholdCache.expires){
        ({houseId,home}=activityHouseholdCache);
      }else{
        const homeRes=await sureFetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
        if(!homeRes.ok)return send('household_error',{events:[],total:0});
        home=await homeRes.json();
        const hs=home.data?.households||home.data?.household||home.households||[];
        const house=Array.isArray(hs)?hs[0]:hs;
        houseId=house?.id||home.data?.household_id||home.data?.household?.id;
        if(houseId)activityHouseholdCache={houseId,home,expires:Date.now()+5*60*1000};
      }
      if(!houseId)return send('household_error',{events:[],total:0});
      // Fast live path: fetch only the newest page. Archive retrieval is separate.
      const response=await sureFetch('https://app.api.surehub.io/api/timeline/household/'+encodeURIComponent(houseId)+'?page=0',{headers,signal:AbortSignal.timeout(12000)});
      if(!response.ok)return send('timeline_error',{events:[],total:0});
      const body=await response.json();
      const items=Array.isArray(body)?body:Array.isArray(body.data)?body.data:Array.isArray(body.data?.entries)?body.data.entries:null;
      if(!items)return send('timeline_error',{events:[],total:0});
      const historyComplete=false,historyError=false,pagesFetched=1,stopReason='live_only',paginationMethod='page_2',paginationTests=[];
      const firstPageOldest=items.at(-1)?.created_at||null,lastPageOldest=firstPageOldest;
      const petLookup=new Map();
      for(const pet of (Array.isArray(home.data?.pets)?home.data.pets:[]))if(pet.id&&pet.name)petLookup.set(String(pet.id),String(pet.name).toLowerCase());
      for(const e of items)for(const p of (Array.isArray(e.pets)?e.pets:[]))if(p.id&&p.name)petLookup.set(String(p.id),String(p.name).toLowerCase());
      const events=items.map(e=>({
        id:String(e.id??''),type:Number(e.type),at:e.created_at,
        pets:(()=>{
          const ids=[...(Array.isArray(e.pets)?e.pets:[]),...(Array.isArray(e.movements)?e.movements:e.movements?[e.movements]:[])];
          const names=ids.map(p=>String(p.name||petLookup.get(String(p.pet_id??p.petId??p.id))||'').toLowerCase()).filter(n=>pets.includes(n));
          return [...new Set(names)];
        })(),
        dataKind:typeof e.data,
        details:(()=>{
          const m=Array.isArray(e.movements)?e.movements[0]:e.movements;
          const candidates=[m,e.movement,e.data?.movement,e.data,e];
          const source=candidates.find(x=>x&&typeof x==='object'&&(x.where!==undefined||x.direction!==undefined||x.position!==undefined||x.side!==undefined))||{};
          const safe={};
          for(const k of ['where','direction','position','side','type','movement_type'])if(['string','number','boolean'].includes(typeof source[k]))safe[k]=source[k];
          return safe;
        })()
      })).filter(e=>Number.isFinite(new Date(e.at).getTime()));
      events.sort((a,b)=>new Date(b.at)-new Date(a.at));
      // First observed movement event per session: age is NOT physical-to-screen latency.
      const newest=events.find(e=>e.type===0&&Number.isFinite(Date.parse(e.at)));
      if(newest&&Date.parse(newest.at)>lastMovementObservedAt)lastMovementObservedAt=Date.parse(newest.at);
      // Observe identifiable cat movements from the existing activity request only.
      for(const e of [...events].reverse()){
       if(e.type!==0||!e.id||observedMovementIds.has(e.id))continue;
       observedMovementIds.add(e.id);
       const movement=Number(e.details?.direction)===1?'In':Number(e.details?.direction)===2?'Out':null;
       if(movement)for(const pet of e.pets||[])reliabilityDiagnostics.record('sure_cloud','movement_observed',Date.now(),{ok:true,sourceUpdatedAt:e.at,pet,movement,eventAt:e.at});
      }
      if(observedMovementIds.size>1500)for(const id of [...observedMovementIds].slice(0,observedMovementIds.size-750))observedMovementIds.delete(id);
      try{
        const file='/data/sure-activity-cache.json';let saved=[];try{saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(saved))saved=[];}catch{}
        const map=new Map(saved.map(e=>[e.id,e]));for(const e of events)if(e.id)map.set(e.id,e);
        const merged=[...map.values()].filter(e=>Number.isFinite(Date.parse(e.at))).sort((a,b)=>new Date(b.at)-new Date(a.at));
        fs.writeFileSync(file,JSON.stringify(merged),{mode:0o600});
        const detail={events:merged.filter(e=>Date.parse(e.at)>Date.now()-2*86400000).slice(0,250),total:merged.length,historyComplete,historyError,pagesFetched,stopReason,paginationMethod,paginationTests,firstPageOldest,lastPageOldest,oldestEvent:merged.at(-1)?.at||null,source:'Sure Petcare timeline; six-month backfill with long-term local retention'};
        activitySnapshot={at:Date.now(),status:'connected',detail};
        return send('connected',detail);
      }catch{return send('connected_no_cache',{events,total:events.length,historyComplete,historyError,pagesFetched,stopReason,paginationMethod,paginationTests});}
    }catch{return send('connection_error',{events:[],total:0});}
  }
  if(url.pathname==='/live/status'){
    const diagnosticStart=Date.now();
    if(haWsConnected&&pets.every(p=>liveEntityCache.has('binary_sensor.'+p))){
      const snap=buildStatusSnapshot();
      reliabilityDiagnostics.record('home_assistant','pet_presence',diagnosticStart,{ok:true,status:200,sourceUpdatedAt:snap.pets.map(p=>p.changed).filter(Boolean).sort().at(-1)||null});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(snap));
    }
    if(!token){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Home Assistant access unavailable'}));}
    try{
      const result=await Promise.all(pets.map(async p=>{
        const response=await fetch('http://supervisor/core/api/states/binary_sensor.'+p,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw Error('Home Assistant returned '+response.status);
        const data=await response.json();
        liveEntityCache.set('binary_sensor.'+p,{state:data.state,last_changed:data.last_changed,last_updated:data.last_updated});
        return {name:p,state:data.state,changed:data.last_changed};
      }));
      for(const p of result){
       const previous=lastPetStates.get(p.name);
       if(previous!==undefined&&previous!==p.state){
        const movement=p.state==='on'?'In':p.state==='off'?'Out':null;
        if(movement)reliabilityDiagnostics.record('home_assistant','pet_status_change',Date.now(),{ok:true,pet:p.name,movement,eventAt:p.changed});
       }
       lastPetStates.set(p.name,p.state);
      }
      reliabilityDiagnostics.record('home_assistant','pet_presence',diagnosticStart,{ok:true,status:200,sourceUpdatedAt:result.map(p=>p.changed).filter(Boolean).sort().at(-1)||null});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({pets:result,updated:new Date().toISOString()}));
    }catch(e){reliabilityDiagnostics.record('home_assistant','pet_presence',diagnosticStart,{ok:false,status:502,error:'read_failed'});res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Unable to read pet status'}));}
  }
  if(url.pathname==='/live/history'){
    if(!token){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Home Assistant access unavailable'}));}
    try{
      const startDate=new Date(Date.now()-24*60*60*1000);
      const start=startDate.toISOString();
      const ids=pets.map(p=>'binary_sensor.'+p).join(',');
      const params=new URLSearchParams({filter_entity_id:ids,significant_changes_only:'0'});
      const endpoint='http://supervisor/core/api/history/period/'+encodeURIComponent(start)+'?'+params.toString();
      const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('Home Assistant history returned '+response.status);
      const histories=await response.json();
      if(!Array.isArray(histories))throw Error('Invalid history');
      const events=[];
      for(const records of histories){
        if(!Array.isArray(records)||!records.length)continue;
        let previous=null;
        for(let i=0;i<records.length;i++){
          const item=records[i];
          const id=item.entity_id||records[0].entity_id;
          const name=String(id||'').replace('binary_sensor.','');
          if(!pets.includes(name))continue;
          const state=item.state;
          if(state!=='on'&&state!=='off'){previous=null;continue;}
          const timestamp=item.last_changed||item.last_updated;
          if(!timestamp)continue;
          const at=new Date(timestamp);
          if(!Number.isFinite(at.getTime()))continue;
          // The first record is the state at the beginning of the period, not a movement.
          if(i>0&&previous!==null&&state!==previous&&at>startDate)events.push({name,state,at:at.toISOString()});
          previous=state;
        }
      }
      events.sort((a,b)=>new Date(b.at)-new Date(a.at));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({events:events.slice(0,100),total:events.length,periodHours:24}));
    }catch(e){res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Unable to read movement history'}));}
  }
  const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','manifest.webmanifest','sw.js','live.js','icon.svg','icon-192.png','icon-512.png'].includes(filename)){res.writeHead(404);return res.end();}
  const file=path.join(base,filename);
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(body);});
};
// Historical backfill is independent of live polling, capped to three pages per cycle.
let archiveBusy=false;
async function archiveBackfill(){
 // Historical import is optional: never compete with active interactive requests.
 if(Date.now()-(sureTraffic.lastInteractive||0)<120000)return;
 if(archiveBusy)return;archiveBusy=true;
 try{
  let opts={};try{opts=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
  if(!opts.sure_email||!opts.sure_password)return;
  const file='/data/sure-activity-cache.json',progress='/data/sure-archive-progress.json';
  let page=2;try{const p=JSON.parse(fs.readFileSync(progress,'utf8'));if(p.complete)return;page=Math.max(2,Number(p.nextPage)||2);}catch{}
  const deviceId=sureDeviceId,headers={'Accept':'application/json','Content-Type':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
  const login=await sureFetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:opts.sure_email,password:opts.sure_password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
  if(!login.ok)return;const auth=await login.json(),access=auth.data?.token||auth.token;if(!access)return;headers.Authorization='Bearer '+access;
  const start=await sureFetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});if(!start.ok)return;
  const home=await start.json(),hs=home.data?.households||home.data?.household||home.households||[],house=Array.isArray(hs)?hs[0]:hs;
  const houseId=house?.id||home.data?.household_id||home.data?.household?.id;if(!houseId)return;
  const lookup=new Map();for(const p of Array.isArray(home.data?.pets)?home.data.pets:[])if(p.id&&p.name)lookup.set(String(p.id),String(p.name).toLowerCase());
  let saved=[];try{saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(saved))saved=[];}catch{}
  const map=new Map(saved.filter(e=>e.id).map(e=>[String(e.id),e]));
  let complete=false;
  for(let i=0;i<3;i++){
   const response=await sureFetch('https://app.api.surehub.io/api/timeline/household/'+encodeURIComponent(houseId)+'?page='+page,{headers,signal:AbortSignal.timeout(12000)});
   if(!response.ok)break;const body=await response.json(),batch=Array.isArray(body)?body:Array.isArray(body.data)?body.data:Array.isArray(body.data?.entries)?body.data.entries:null;
   if(!batch)break;if(!batch.length){complete=true;break;}
   let oldest=Infinity,newCount=0;
   for(const e of batch){
    const id=String(e.id??''),at=e.created_at;if(!id||!Number.isFinite(Date.parse(at)))continue;
    oldest=Math.min(oldest,Date.parse(at));
    if(map.has(id))continue;
    const ids=[...(Array.isArray(e.pets)?e.pets:[]),...(Array.isArray(e.movements)?e.movements:e.movements?[e.movements]:[])];
    const names=[...new Set(ids.map(p=>String(p.name||petLookup.get(String(p.pet_id??p.petId??p.id))||'').toLowerCase()).filter(n=>pets.includes(n)))];
    const m=Array.isArray(e.movements)?e.movements[0]:e.movements;
    const source=[m,e.movement,e.data?.movement,e.data,e].find(x=>x&&typeof x==='object'&&(x.direction!==undefined||x.side!==undefined||x.where!==undefined))||{};
    const details={};for(const k of ['where','direction','position','side','type','movement_type'])if(['string','number','boolean'].includes(typeof source[k]))details[k]=source[k];
    map.set(id,{id,type:Number(e.type),at,pets:names,details});newCount++;
   }
   if(!newCount){complete=true;break;}
   page++;
   if(oldest<Date.now()-183*86400000){complete=true;break;}
  }
  const merged=[...map.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  fs.writeFileSync(file,JSON.stringify(merged),{mode:0o600});
  fs.writeFileSync(progress,JSON.stringify({nextPage:page,complete,updated:new Date().toISOString()}),{mode:0o600});
 }catch{}finally{archiveBusy=false;}
}
setTimeout(archiveBackfill,60000);
setInterval(archiveBackfill,900000);
const server=http.createServer((req,res)=>handleRequest(req,res,false));
server.listen(80,'0.0.0.0');
// The SAME server and scheduler serve both Home Assistant ingress and authenticated
// standalone requests. There is no second scheduler or duplicate state store.
if(standaloneEnabled){
  const standaloneServer=http.createServer((req,res)=>handleRequest(req,res,true));
  standaloneServer.listen(8080,'0.0.0.0');
}
