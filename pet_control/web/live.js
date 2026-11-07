(function(){
const names=['Jessie','Henry','Rosie','Violet'];
const section=document.createElement('section');
section.className='card';section.style.cssText='margin-top:14px;background:#fff;color:#19312d;width:100%;';
section.innerHTML='<strong>Live Sure Petcare status</strong><div id="pet-live-list" style="margin-top:8px">Connecting to Home Assistant…</div><small id="pet-live-time"></small>';
const flapSection=document.createElement('section');
flapSection.className='card';
flapSection.style.cssText='margin-top:14px;background:#fff;color:#19312d;width:100%;';
flapSection.innerHTML='<strong>Cat flap — live lock status</strong><div id="flap-live-status" style="margin-top:8px">Checking Home Assistant…</div><p class="small" style="margin-bottom:0">Controls use the exit restriction only. Entry remains permitted.</p>';
let flapPending=false,flapCommandPending=false,flapConfirmed=null,flapMessage='',flapDesired=null,flapLastSuccess=0,flapRetryTimer=null;
const flapWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function syncFlapUI(){
 const target=document.getElementById('flap-live-status'),checkbox=document.getElementById('houseIndoorToggle'),label=document.getElementById('houseIndoorStatus');
 const known=flapConfirmed==='indoor_only'||flapConfirmed==='normal';
 const fresh=known&&Date.now()-flapLastSuccess<30000;
 const status=flapConfirmed==='indoor_only'?'Indoor only — exits restricted, entry allowed':flapConfirmed==='normal'?'Free Access — entry and exit allowed':'Checking flap status…';
 if(target)target.textContent=flapMessage||status;
 if(checkbox){checkbox.disabled=flapCommandPending||!fresh;checkbox.checked=flapCommandPending&&flapDesired?flapDesired==='indoor_only':flapConfirmed==='indoor_only';}
 if(label)label.textContent=flapCommandPending?'Waiting for Home Assistant to confirm…':flapMessage||(fresh?'Confirmed by Home Assistant':'Checking connection — controls temporarily unavailable');
}
window.syncLiveFlapUI=syncFlapUI;
async function readFlap(){
 const response=await fetch('./live/flap',{cache:'no-store',signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw Error('Status request delayed');
 const data=await response.json();
 if(data.status!=='normal'&&data.status!=='indoor_only')throw Error('Status not yet available');
 return data.status;
}
function scheduleFlapRetry(){
 if(flapRetryTimer||flapCommandPending)return;
 flapRetryTimer=setTimeout(()=>{flapRetryTimer=null;refreshFlap();},3000);
}
async function refreshFlap(){
 if(flapPending||flapCommandPending||document.hidden)return;
 flapPending=true;
 try{
  const actual=await readFlap();
  flapConfirmed=actual;flapLastSuccess=Date.now();flapMessage='';
 }catch{
  // Preserve the last verified position, but do not permit commands on stale data.
  flapMessage='Checking flap connection… Last confirmed: '+(flapConfirmed==='indoor_only'?'Indoor only':flapConfirmed==='normal'?'Free Access':'not available');
  scheduleFlapRetry();
 }finally{flapPending=false;syncFlapUI();}
}
window.setLiveFlapMode=async function(enabled){
 if(flapCommandPending||!flapConfirmed||Date.now()-flapLastSuccess>=30000){syncFlapUI();return;}
 const desired=enabled?'indoor_only':'normal';
 if(desired===flapConfirmed){syncFlapUI();return;}
 flapCommandPending=true;flapDesired=desired;
 flapMessage=enabled?'Changing to Indoor only… Please wait.':'Changing to Free Access… Please wait.';
 syncFlapUI();
 try{
  const response=await fetch('./live/flap/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:desired}),signal:AbortSignal.timeout(18000)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Unable to send command');
  if(result.status==='confirmed'){
   flapConfirmed=desired;flapLastSuccess=Date.now();flapMessage='Change confirmed by Home Assistant';
  }else{
   flapMessage='Command sent — waiting for the flap to respond…';
   syncFlapUI();
   let matched=false;
   for(let i=0;i<10;i++){
    await flapWait(1500);
    try{
     const actual=await readFlap();
     flapConfirmed=actual;flapLastSuccess=Date.now();
     if(actual===desired){matched=true;break;}
    }catch{}
   }
   if(!matched)throw Error('Still waiting for confirmation — check Home Assistant');
   flapMessage='Change confirmed by Home Assistant';
  }
 }catch(error){
  flapMessage=error.message||'Change not yet confirmed';
  try{flapConfirmed=await readFlap();flapLastSuccess=Date.now();}catch{}
 }finally{
  flapCommandPending=false;flapDesired=null;syncFlapUI();
  setTimeout(()=>{if(!flapCommandPending){flapMessage='';refreshFlap();}},4500);
 }
};
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ukDay=d=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
const dayKey=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return ukDay(d);};
let activity=[];let loaded=false;let pending=null;let lastFetched=0;
let trendDays=7;let historyInfo=null;let archiveDay='',archiveEvents=[];
window.setTrendDays=function(n){trendDays=n===28?28:7;if(typeof window.renderSureTimeline==='function')window.renderSureTimeline();};
function renderTrend(date,filter){
 const root=document.getElementById('timelineTrend');if(!root)return;
 const all=records().filter(e=>e.direction==='In'||e.direction==='Out').filter(e=>filter==='all'||e.pet===String((state.pets||[]).find(p=>p.id===filter)?.name||'').toLowerCase());
 const days=[];let total=0;
 for(let i=trendDays-1;i>=0;i--){const d=new Date(date);d.setDate(d.getDate()-i);const key=ukDay(d);const daily=all.filter(e=>ukDay(new Date(e.at))===key);const entries=daily.filter(e=>e.direction==='In').length;total+=entries;days.push({key,entries,label:d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric'})});}
 const max=Math.max(1,...days.map(d=>d.entries));
 document.getElementById('trend7')?.classList.toggle('active',trendDays===7);document.getElementById('trend28')?.classList.toggle('active',trendDays===28);
 root.innerHTML='<div class="small" style="margin-bottom:12px"><strong>'+total+'</strong> recorded entries · '+trendDays+' days · average '+(total/trendDays).toFixed(1)+' per day</div><div style="display:flex;align-items:flex-end;gap:3px;height:95px;border-bottom:1px solid #cadbd7">'+days.map(d=>'<div title="'+escapeHtml(d.label+': '+d.entries+' entries')+'" style="flex:1;min-width:2px;height:'+Math.max(3,Math.round(d.entries/max*90))+'px;background:#21b7bd;border-radius:3px 3px 0 0"></div>').join('')+'</div><div class="small" style="display:flex;justify-content:space-between;margin-top:6px"><span>'+escapeHtml(days[0].label)+'</span><span>'+escapeHtml(days.at(-1).label)+'</span></div><p class="small">Based on retrieved movement records only. Missing history can make totals incomplete.</p>';
}

try{const saved=JSON.parse(sessionStorage.getItem('pet-sure-activity-v211')||'null');if(saved&&Array.isArray(saved.events)){activity=saved.events;loaded=true;}}catch{}
function direction(e){
 if(e.type!==0)return 'Unknown';
 const raw=e.details||{};
 // Sure Petcare movement diagnostics: 1/side 1 = entered, 2/side 0 = left.
 // Direction 0 is not a confirmed crossing and must not be counted.
 const value=raw.direction;
 if(value===1||value==='1')return 'In';
 if(value===2||value==='2')return 'Out';
 return 'Unknown';
}
function records(){return [...activity,...archiveEvents.filter(e=>!activity.some(a=>a.id===e.id))].filter(e=>e.type===0).flatMap(e=>(e.pets||[]).filter(p=>names.some(n=>n.toLowerCase()===p)).map(p=>({...e,pet:p,direction:direction(e)}))).sort((a,b)=>new Date(b.at)-new Date(a.at));}
function iconFor(e){return e.direction==='In'?'↙':e.direction==='Out'?'↗':'↔';}
function labelFor(e){return e.direction==='In'?'Entered':e.direction==='Out'?'Left':'Activity recorded';}
function rowFor(e,fullDate=false){
 const name=names.find(n=>n.toLowerCase()===e.pet)||e.pet;
 const time=new Date(e.at).toLocaleString('en-GB',{timeZone:'Europe/London',...(fullDate?{day:'numeric',month:'short'}:{}),hour:'2-digit',minute:'2-digit'});
 return '<div class="listrow"><div class="row"><div class="eventicon" aria-label="'+labelFor(e)+'">'+iconFor(e)+'</div><div><strong>'+escapeHtml(name)+'</strong><div class="small">'+labelFor(e)+'</div></div></div><span class="small">'+time+'</span></div>';
}
function paint(){
 window.petLiveHistoryLoaded=true;
 const box=document.getElementById('homeEvents'),count=document.getElementById('countEvents');
 if(box&&count){
  const today=ukDay(new Date()),todayEvents=records().filter(e=>ukDay(new Date(e.at))===today);
  count.textContent=loaded?String(todayEvents.filter(e=>e.direction!=='Unknown').length):'–';
  box.style.maxHeight='330px';box.style.overflowY='auto';box.style.overscrollBehavior='contain';
  if(loaded)box.innerHTML=todayEvents.length?todayEvents.slice(0,35).map(e=>rowFor(e)).join(''):'<div class="empty">No activity recorded today.</div>';
 }
 if(document.getElementById('timeline')?.classList.contains('active')&&typeof window.renderSureTimeline==='function')window.renderSureTimeline();
 if(document.getElementById('petDetailContent')?.closest('.page.active')&&typeof window.renderSurePetDetail==='function')window.renderSurePetDetail();
}
window.renderSurePetDetail=function(){
 const root=document.getElementById('petDetailContent');
 if(!root||!root.closest('.page.active'))return;
 const p=typeof selectedPetId!=='undefined'?(state.pets||[]).find(x=>x.id===selectedPetId):null;
 if(!p)return;
 const petName=p.name.toLowerCase();
 const events=records().filter(e=>e.pet===petName);
 const status=window.sureLiveStates?.[petName]||'Unknown';
 const summary=events.slice(0,10).map(e=>rowFor(e,true)).join('')||'<div class="empty">No Sure Petcare activity recorded.</div>';
 root.innerHTML='<div class="card"><div class="detailhero">'+(typeof petAvatar==='function'?petAvatar(p):'')+'<h2>'+escapeHtml(p.name)+'</h2></div><h2 style="display:none">'+escapeHtml(p.name)+'</h2><p><strong>Current status: '+escapeHtml(status)+'</strong></p><p class="small">Live presence from Home Assistant</p><div class="card" style="margin:12px 0;background:#f4f8f5"><strong>Indoor-only preference</strong><div class="row between" style="margin-top:8px"><span>'+((typeof state!=='undefined'&&state.houseIndoor)?'Whole-house Indoor-only':p.indoorMode==='indoor'?'Indoor-only':p.indoorMode==='scheduled'?'Scheduled':'Free Access')+'</span><button class="button secondary" onclick="openPet(\''+escapeHtml(p.id)+'\')">Change setting</button></div></div><div class="row"><button class="button secondary" onclick="showPetTimeline(\''+escapeHtml(p.id)+'\')">View full timeline</button><button class="button secondary" onclick="openPetCurfew(\''+escapeHtml(p.id)+'\')">Curfew settings</button></div></div><div class="card" style="margin-top:12px"><h3>Recent activity</h3>'+summary+'</div>';
};
window.renderSureTimeline=function(){
 const target=document.getElementById('timelineEvents'),count=document.getElementById('eventCount');
 if(!target||!count||!target.closest('.page.active'))return;
 const offset=typeof dayOffset==='number'?dayOffset:0;
 const date=new Date();date.setDate(date.getDate()+offset);
 const key=ukDay(date);
 const filter=document.getElementById('filterPet')?.value||'all',type=document.getElementById('filterType')?.value||'all';
 if(archiveDay!==key){archiveDay=key;archiveEvents=[];fetch('./sure/archive?date='+encodeURIComponent(key),{cache:'no-store'}).then(r=>r.json()).then(d=>{if(archiveDay===key){archiveEvents=d.events||[];window.renderSureTimeline();}}).catch(()=>{});}
 const list=records().filter(e=>ukDay(new Date(e.at))===key&&(filter==='all'||e.pet===String((state.pets||[]).find(p=>p.id===filter)?.name||'').toLowerCase())&&(type==='all'||e.direction===type));
 document.getElementById('selectedDayLabel').textContent=offset===0?'Today':offset===-1?'Yesterday':date.toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'long'});
 document.getElementById('selectedDayDate').textContent=date.toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'long',year:'numeric'});

 const archiveControls=document.getElementById('archive-download-controls');if(!archiveControls){const controls=document.createElement('div');controls.id='archive-download-controls';controls.className='card';controls.style.margin='10px 0';controls.innerHTML='<strong>Saved movement archive</strong><p class="small">Download your stored movements for veterinary records or analysis.</p><a class="button secondary" href="./sure/archive?format=csv" download>Download CSV</a>';target.before(controls);}

 const picker=document.getElementById('timelineDatePicker');if(picker){picker.value=key;picker.max=ukDay(new Date());}document.getElementById('prevDay').disabled=false;document.getElementById('nextDay').disabled=offset>=0;document.getElementById('todayButton').style.display=offset===0?'none':'block';
 count.textContent=loaded?list.filter(e=>e.direction!=='Unknown').length+' confirmed movements · '+list.filter(e=>e.direction==='In').length+' in · '+list.filter(e=>e.direction==='Out').length+' out · '+list.filter(e=>e.direction==='Unknown').length+' needing verification':'Loading activity…';
 target.style.maxHeight='65vh';target.style.overflowY='auto';
 target.innerHTML=!loaded?'<div class="empty">Loading live Sure Petcare activity…</div>':list.length?list.map(e=>rowFor(e,true)).join(''):'<div class="empty">No matching activity recorded for this day.</div>';
 renderGraphs();
};

let graphCache=null,graphActivityRef=null,graphArchiveRef=null;
let rangeArchive=[],rangeLoading=false,rangeError='',rangeToken=0,rangeInitialized=false;
const archiveCache=new Map();
const graphToday=()=>ukDay(new Date());
const shiftDay=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
let graphEnd=graphToday(),graphStart=graphEnd.slice(0,7)+'-01';
function rangeDays(){const days=[];for(let d=graphStart;d<=graphEnd&&days.length<90;d=shiftDay(d,1))days.push(d);return days;}
function refreshRangeFromCache(dates){
 rangeArchive=dates.flatMap(day=>archiveCache.get(day)||[]);
 graphCache=null;
 renderGraphs();
}
async function loadGraphRange(){
 const token=++rangeToken,dates=rangeDays();
 rangeLoading=true;rangeError='';
 // Draw once immediately; do not repeatedly rebuild the graph while downloading.
 refreshRangeFromCache(dates);
 const missing=dates.filter(day=>!archiveCache.has(day));
 let cursor=0,failures=0;
 async function worker(){
  while(cursor<missing.length&&token===rangeToken){
   const day=missing[cursor++];
   try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    let resp;
    try{resp=await fetch('./sure/archive?date='+encodeURIComponent(day),{cache:'no-store',signal:controller.signal});}
    finally{clearTimeout(timeout);}
    if(!resp.ok)throw Error('Archive unavailable');
    const data=await resp.json();
    if(!Array.isArray(data.events))throw Error('Invalid archive');
    if(token!==rangeToken)return;
    archiveCache.set(day,data.events);
   }catch{failures++;}
  }
 }
 // Two requests at once protects Home Assistant on slower devices.
 await Promise.all(Array.from({length:Math.min(2,missing.length)},worker));
 if(token!==rangeToken)return;
 rangeLoading=false;
 rangeError=failures?failures+' day(s) could not be loaded. Totals may be incomplete.':'';
 refreshRangeFromCache(dates);
}
window.petGraphDates=function(){const a=document.getElementById('graph-from')?.value,b=document.getElementById('graph-to')?.value;if(!a||!b||a>b||b>graphToday()){alert('Please select a valid date range, ending no later than today.');return;}const count=Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000)+1;if(count>90){alert('Please choose a range of up to 90 days.');return;}graphStart=a;graphEnd=b;graphRange=0;loadGraphRange();};
function graphRecords(){
 if(graphCache&&graphActivityRef===activity&&graphArchiveRef===archiveEvents)return graphCache;
 graphActivityRef=activity;graphArchiveRef=archiveEvents;
 graphCache=[...new Map([...activity,...rangeArchive,...archiveEvents].map(e=>[e.id,e])).values()].filter(e=>e.type===0).flatMap(e=>(e.pets||[]).filter(p=>names.some(n=>n.toLowerCase()===p)).map(p=>({...e,pet:p,direction:direction(e)}))).filter(e=>e.direction==='In'||e.direction==='Out').map(e=>({pet:e.pet,direction:e.direction,at:new Date(e.at).getTime(),day:ukDay(new Date(e.at))})).filter(e=>Number.isFinite(e.at));
 return graphCache;
}
function graphTrips(){
 const sorted=graphRecords().slice().sort((a,b)=>a.at-b.at),open=new Map(),trips=[];
 for(const e of sorted){if(e.direction==='Out'){if(!open.has(e.pet))open.set(e.pet,e.at);}
 else {const start=open.get(e.pet);if(start!==undefined&&e.at>start){trips.push({pet:e.pet,start,end:e.at});open.delete(e.pet);}}}
 return trips;
}
function graphDayBounds(day){
 const start=new Date(day+'T00:00:00Z').getTime();
 let lo=start-86400000,hi=start+86400000;
 while(hi-lo>1000){const mid=Math.floor((lo+hi)/2);if(ukDay(new Date(mid))<day)lo=mid;else hi=mid;}
 const first=hi;lo=first;hi=first+2*86400000;
 while(hi-lo>1000){const mid=Math.floor((lo+hi)/2);if(ukDay(new Date(mid))<=day)lo=mid;else hi=mid;}
 return [first,hi];
}
function graphDayTrips(day,pet){
 const [a,b]=graphDayBounds(day);
 return graphTrips().filter(t=>(pet==='all'||t.pet===pet)&&t.start<b&&t.end>a).map(t=>({...t,minutes:Math.max(0,Math.min(t.end,b)-Math.max(t.start,a))/60000}));
}
function graphDuration(ms){const mins=Math.round(ms/60000);return Math.floor(mins/60)+'h '+String(mins%60).padStart(2,'0')+'m';}
let graphRange=7,graphPet='all',graphSelected='',graphMetric='move';
window.petGraphMetric=function(v){graphMetric=v==='time'?'time':'move';renderGraphs();};
window.petGraphRange=function(n){graphRange=n===28?28:7;graphEnd=graphToday();graphStart=shiftDay(graphEnd,1-graphRange);loadGraphRange();};
window.petGraphPet=function(v){graphPet=v;renderGraphs();};
let graphSelectedDirection='all';
window.petGraphDay=function(v,direction='all'){graphSelected=v;graphSelectedDirection=direction;showGraphPopup(v);};
let graphPopupSort='newest';
window.petGraphPopupSort=function(v){graphPopupSort=v==='oldest'?'oldest':'newest';showGraphPopup(graphSelected);};
function showGraphPopup(day){
 const all=graphRecords().filter(e=>e.day===day&&(graphPet==='all'||e.pet===graphPet));
 const events=all.filter(e=>graphMetric==='time'||graphSelectedDirection==='all'||e.direction===graphSelectedDirection).slice().sort((a,b)=>graphPopupSort==='oldest'?a.at-b.at:b.at-a.at);
 const entries=events.filter(e=>e.direction==='In').length,exits=events.filter(e=>e.direction==='Out').length;
 const clock=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'});
 const name=p=>p.charAt(0).toUpperCase()+p.slice(1);
 const byCat=new Map();
 for(const e of events){if(!byCat.has(e.pet))byCat.set(e.pet,{ins:0,outs:0});byCat.get(e.pet)[e.direction==='In'?'ins':'outs']++;}
 const cats=[...byCat].map(([p,v])=>'<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0"><strong>'+escapeHtml(name(p))+'</strong><span>'+v.ins+' in · '+v.outs+' out</span></div>').join('');
 const rows=events.map(e=>'<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e3e8e6"><span>'+escapeHtml(name(e.pet))+' · '+(e.direction==='In'?'Entered':'Left')+'</span><strong>'+clock(e.at)+'</strong></div>').join('');
 const sessions=graphDayTrips(day,graphPet).sort((a,b)=>graphPopupSort==='oldest'?a.start-b.start:b.start-a.start);
 const duration=graphDuration;
 const trips=sessions.map(x=>'<div style="padding:8px 0;border-bottom:1px solid #e3e8e6"><strong>'+escapeHtml(name(x.pet))+'</strong><div class="small">Out '+clock(x.start)+' · In '+clock(x.end)+' · '+duration(x.end-x.start)+(x.minutes*60000<x.end-x.start?' · '+duration(x.minutes*60000)+' on this day':'')+'</div></div>').join('');
 const dailyMinutes=sessions.reduce((n,t)=>n+t.minutes,0),longest=sessions.reduce((n,t)=>Math.max(n,t.end-t.start),0);
 const daySummary='<p><strong>Total outside: '+duration(dailyMinutes*60000)+'</strong> · '+sessions.length+' completed trips · Longest trip: '+duration(longest)+'</p>';
 const popupContent=graphMetric==='time'?daySummary+'<div style="max-height:40vh;overflow:auto">'+(trips||'<p class="small">No completed trips in the available records.</p>')+'</div>' :'<p><strong>'+(graphSelectedDirection==='In'?entries+' entries':graphSelectedDirection==='Out'?exits+' exits':entries+' entries · '+exits+' exits')+'</strong></p>'+(cats||'<p>No confirmed movements recorded.</p>')+'<div style="max-height:40vh;overflow:auto">'+(rows||'<p class="small">No recorded movements for this day.</p>')+'</div>';
  let overlay=document.getElementById('pet-graph-popup');
 if(!overlay){overlay=document.createElement('div');overlay.id='pet-graph-popup';overlay.setAttribute('role','presentation');overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:14px';overlay.addEventListener('click',e=>{if(e.target===overlay)window.closePetGraphPopup();});document.body.appendChild(overlay);}
 const title=new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 overlay.innerHTML='<div role="dialog" aria-modal="true" aria-label="Activity details for '+escapeHtml(title)+'" style="background:#fff;color:#19312d;border-radius:14px;padding:18px;width:min(100%,460px);max-height:85vh;overflow:auto;box-shadow:0 10px 40px #0004"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><h3 style="margin:0">'+escapeHtml(title)+'</h3><button type="button" class="button secondary" onclick="closePetGraphPopup()" aria-label="Close activity details">Close ✕</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h4>'+(graphMetric==='time'?'Outside trips':graphSelectedDirection==='In'?'Entries':graphSelectedDirection==='Out'?'Exits':'Movement times')+'</h4><label>Order <select aria-label="Sort activity" onchange="petGraphPopupSort(this.value)"><option value="newest"'+(graphPopupSort==='newest'?' selected':'')+'>Newest first</option><option value="oldest"'+(graphPopupSort==='oldest'?' selected':'')+'>Oldest first</option></select></label></div>'+popupContent+'<p class="small">Based on retrieved confirmed events. Missing or unfinished trips are excluded.</p></div>';
 overlay.style.display='flex';overlay.querySelector('button')?.focus();
}
window.closePetGraphPopup=function(){const el=document.getElementById('pet-graph-popup');if(el)el.style.display='none';};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('pet-graph-popup')?.style.display==='flex')window.closePetGraphPopup();});
function renderGraphs(){
 const page=document.getElementById('timeline');
 if(!page?.classList.contains('active'))return;
 if(!rangeInitialized){rangeInitialized=true;rangeLoading=false;}
 let root=document.getElementById('pet-graphs');
 if(!root){root=document.createElement('div');root.id='pet-graphs';page.querySelector('.sectionhead')?.after(root);}root.classList.add('card');root.style.margin='0 0 12px';
 const events=graphRecords().filter(e=>graphPet==='all'||e.pet===graphPet);
 const today=graphToday(),days=[];
 for(const day of rangeDays())days.push({day,ins:0,outs:0,minutes:0});
 const byDay=new Map(days.map(d=>[d.day,d]));
 for(const e of events){const b=byDay.get(e.day);if(b){if(e.direction==='In')b.ins++;else b.outs++;}}
 const trips=graphTrips().filter(t=>graphPet==='all'||t.pet===graphPet);
 const bounds=days.map(d=>graphDayBounds(d.day));
 for(let i=0;i<days.length;i++){const d=days[i],[a,b]=bounds[i];for(const t of trips){if(t.start<b&&t.end>a)d.minutes+=Math.max(0,Math.min(t.end,b)-Math.max(t.start,a))/60000;}}
 const avgMinutes=days.reduce((n,d)=>n+d.minutes,0)/days.length;
 const daySet=new Set(days.map(d=>d.day));
 const tripsInRange=trips.filter(t=>daySet.has(ukDay(new Date(t.start))));
 const avgTrips=tripsInRange.length/days.length;
 const longestTrip=tripsInRange.reduce((n,t)=>Math.max(n,t.end-t.start),0);
 const maxMove=Math.max(1,...days.map(d=>Math.max(d.ins,d.outs))),maxTime=Math.max(1,...days.map(d=>d.minutes));
 const ukLabel=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'short'});
 const ukLong=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'long',year:'numeric'});
 const monthHeading=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',month:'long',year:'numeric'});
 const rangeHeading=monthHeading(days[0].day)===monthHeading(days[days.length-1].day)?monthHeading(days[days.length-1].day):monthHeading(days[0].day)+' – '+monthHeading(days[days.length-1].day);
 const bar=(value,max,color,day,title,direction)=>'<button type="button" onclick="petGraphDay(&#39;'+day+'&#39;,&#39;'+direction+'&#39;)" title="'+escapeHtml(title)+'" style="display:block;width:100%;height:'+Math.max(3,Math.round(value/max*94))+'px;background:'+color+';border:0;border-radius:3px 3px 0 0;padding:0;cursor:pointer" aria-label="'+escapeHtml(title)+'"></button>';
 const bars=kind=>'<div style="overflow-x:auto;touch-action:pan-x;padding-bottom:6px"><div style="display:flex;gap:5px;align-items:flex-end;min-width:max-content;border-bottom:1px solid #cbd9d4">'+days.map(d=>'<div style="width:'+(days.length>14?'47':'55')+'px;flex:none;text-align:center"><div style="display:flex;align-items:flex-end;gap:2px;height:112px">'+(kind==='move'?'<div style="flex:1">'+bar(d.ins,maxMove,'#178f99',d.day,ukLong(d.day)+': '+d.ins+' entries','In')+'</div><div style="flex:1">'+bar(d.outs,maxMove,'#e49a46',d.day,ukLong(d.day)+': '+d.outs+' exits','Out')+'</div>':bar(d.minutes,maxTime,'#5d7ec3',d.day,ukLong(d.day)+': '+Math.round(d.minutes)+' minutes outside','all'))+'</div><div style="font-size:11px;white-space:nowrap;padding:5px 0;font-weight:'+(d.day===today?'700':'400')+'">'+escapeHtml(ukLabel(d.day))+'</div></div>').join('')+'</div></div>';

 const selected=byDay.get(graphSelected)||days[days.length-1];
 const opts=['all',...names.map(n=>n.toLowerCase())].map(n=>'<option value="'+escapeHtml(n)+'"'+(graphPet===n?' selected':'')+'>'+(n==='all'?'All cats':escapeHtml(n.charAt(0).toUpperCase()+n.slice(1)))+'</option>').join('');
 root.innerHTML='<h3 style="margin-top:0">Cat activity</h3><div class="row" style="gap:8px;flex-wrap:wrap"><label>View <select aria-label="Graph metric" onchange="petGraphMetric(this.value)"><option value="move"'+(graphMetric==='move'?' selected':'')+'>Entries and exits</option><option value="time"'+(graphMetric==='time'?' selected':'')+'>Time outside</option></select></label><label>Cat <select onchange="petGraphPet(this.value)">'+opts+'</select></label><button class="button secondary" onclick="petGraphRange(7)" '+(graphRange===7?'aria-pressed="true"':'')+'>7 days</button><button class="button secondary" onclick="petGraphRange(28)" '+(graphRange===28?'aria-pressed="true"':'')+'>28 days</button></div><div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px"><label>From <input id="graph-from" type="date" value="'+graphStart+'" max="'+today+'"></label><label>To <input id="graph-to" type="date" value="'+graphEnd+'" max="'+today+'"></label><button class="button secondary" onclick="petGraphDates()">Show dates</button></div><p class="small">Select dates using the calendar (day/month/year). Showing '+days.length+' days.</p>'+(graphMetric==='move'?'Entries and exits':'Time spent outside')+'</h4><p class="small" style="font-weight:700">'+escapeHtml(rangeHeading)+'</p>'+bars(graphMetric)+'<p class="small">'+(graphMetric==='move'?'Blue: entries · Orange: exits':'Blue: minutes outside between confirmed exit and return')+'</p><p class="small">Daily average outside: '+graphDuration(avgMinutes*60000)+' · Average completed trips/day: '+avgTrips.toFixed(1)+' · Longest trip: '+graphDuration(longestTrip)+'</p><div class="small">'+escapeHtml(ukLong(days[0].day))+' to '+escapeHtml(ukLong(graphEnd))+'</div><p class="small">Tap a bar for '+(graphMetric==='move'?'movement times':'individual trip durations')+'. '+(rangeLoading?'Loading older records in the background — graph updates as they arrive…':rangeError?escapeHtml(rangeError):'Showing retrieved confirmed movements for the selected dates.')+'</p>';
}

async function refreshCloud(force=false){
 if(pending)return pending;
 if(document.hidden)return;if(!force&&Date.now()-lastFetched<30000){paint();return;}
 pending=(async()=>{
  try{
   const r=await fetch('./sure/activity',{cache:'no-store'});if(!r.ok)throw Error('unavailable');
   const data=await r.json();if(!String(data.status).startsWith('connected'))throw Error(data.status);
   activity=data.events||[];historyInfo={total:data.total,pagesFetched:data.pagesFetched,oldestEvent:data.oldestEvent,stopReason:data.stopReason,paginationMethod:data.paginationMethod,paginationTests:data.paginationTests};loaded=true;lastFetched=Date.now();
   try{sessionStorage.setItem('pet-sure-activity-v211',JSON.stringify({events:activity}));}catch{}
  }catch{if(!loaded){const box=document.getElementById('homeEvents');if(box)box.innerHTML='<div class="empty">Sure Petcare activity unavailable.</div>';}}
  finally{pending=null;paint();}
 })();
 return pending;
}
const mount=()=>{const home=document.getElementById('home');const stats=home?.querySelector('.stats');if(stats){stats.insertAdjacentElement('afterend',section);section.insertAdjacentElement('afterend',flapSection);}else if(home){home.prepend(section);section.insertAdjacentElement('afterend',flapSection);}else{document.body.prepend(section);section.insertAdjacentElement('afterend',flapSection);}};
let statusPending=false;
async function refresh(){
if(statusPending||document.hidden)return;
statusPending=true;
try{const r=await fetch('./live/status',{cache:'no-store'});if(!r.ok)throw Error('unavailable');const d=await r.json();
window.sureLiveStates=Object.fromEntries(d.pets.map(p=>[p.name,p.state==='on'?'Home':p.state==='off'?'Away':'Unknown']));
if(typeof window.renderSurePetDetail==='function')window.renderSurePetDetail();
document.getElementById('pet-live-list').innerHTML=names.map(n=>{const p=d.pets.find(x=>x.name===n.toLowerCase());const status=p?.state==='on'?'Home':p?.state==='off'?'Away':'Unknown';return '<div style="display:flex;justify-content:space-between;padding:5px 0"><span>'+n+'</span><strong>'+status+'</strong></div>'}).join('');
document.getElementById('pet-live-time').textContent='Updated '+new Date(d.updated).toLocaleTimeString('en-GB');
document.querySelectorAll('#homePets .pet-tap').forEach(card=>{const name=card.querySelector('.petname')?.textContent?.trim();const p=d.pets.find(x=>x.name===name?.toLowerCase());if(!p)return;const pill=card.querySelector('.pill');const detail=card.querySelector('.small');const status=p.state==='on'?'Home':p.state==='off'?'Away':'Unknown';if(pill){pill.textContent=status;pill.classList.toggle('out',status==='Away');}if(detail){detail.innerHTML=detail.innerHTML.replace(/Sample status only|Awaiting live status/g,'Live status from Sure Petcare');}});
}catch(e){if(!window.sureLiveStates)document.getElementById('pet-live-list').textContent='Live status unavailable. Check Home Assistant app logs.';}
finally{statusPending=false;}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();paint();refresh();refreshFlap();refreshCloud();});else{mount();refresh();refreshFlap();refreshCloud();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){paint();refresh();refreshFlap();refreshCloud();}});
setInterval(refresh,5000);setInterval(refreshFlap,15000);setInterval(refreshCloud,60000);
})();
