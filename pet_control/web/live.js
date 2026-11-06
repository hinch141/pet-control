(function(){
const names=['Jessie','Henry','Rosie','Violet'];
const section=document.createElement('section');
section.className='card';section.style.cssText='margin-top:14px;background:#fff;color:#19312d;width:100%;';
section.innerHTML='<strong>Live Sure Petcare status</strong><div id="pet-live-list" style="margin-top:8px">Connecting to Home Assistant…</div><small id="pet-live-time"></small>';
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
 root.innerHTML='<div class="card"><h2>'+escapeHtml(p.name)+'</h2><p><strong>Current status: '+escapeHtml(status)+'</strong></p><p class="small">Live presence from Home Assistant</p><div class="card" style="margin:12px 0;background:#f4f8f5"><strong>Indoor-only preference</strong><div class="row between" style="margin-top:8px"><span>'+((typeof state!=='undefined'&&state.houseIndoor)?'Whole-house Indoor-only':p.indoorMode==='indoor'?'Indoor-only':p.indoorMode==='scheduled'?'Scheduled':'Normal')+'</span><button class="button secondary" onclick="openPet(\''+escapeHtml(p.id)+'\')">Change setting</button></div></div><div class="row"><button class="button secondary" onclick="showPetTimeline(\''+escapeHtml(p.id)+'\')">View full timeline</button><button class="button secondary" onclick="openPetCurfew(\''+escapeHtml(p.id)+'\')">Curfew settings</button></div></div><div class="card" style="margin-top:12px"><h3>Recent activity</h3>'+summary+'</div>';
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
function graphRecords(){
 if(graphCache&&graphActivityRef===activity&&graphArchiveRef===archiveEvents)return graphCache;
 graphActivityRef=activity;graphArchiveRef=archiveEvents;
 graphCache=records().filter(e=>e.direction==='In'||e.direction==='Out').map(e=>({pet:e.pet,direction:e.direction,at:new Date(e.at).getTime(),day:ukDay(new Date(e.at))})).filter(e=>Number.isFinite(e.at));
 return graphCache;
}
let graphRange=7,graphPet='all',graphSelected='',graphMetric='move';
window.petGraphMetric=function(v){graphMetric=v==='time'?'time':'move';renderGraphs();};
window.petGraphRange=function(n){graphRange=n===28?28:7;renderGraphs();};
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
 const sessions=[];const lastOut=new Map();
 const chron=graphRecords().filter(e=>graphPet==='all'||e.pet===graphPet).slice().sort((a,b)=>a.at-b.at);
 for(const e of chron){if(e.direction==='Out'){lastOut.set(e.pet,e.at);}else{const start=lastOut.get(e.pet);if(start!==undefined&&e.at>start){if(ukDay(new Date(start))===day||ukDay(new Date(e.at))===day||day>ukDay(new Date(start))&&day<ukDay(new Date(e.at)))sessions.push({pet:e.pet,start,end:e.at});lastOut.delete(e.pet);}}}
 sessions.sort((a,b)=>graphPopupSort==='oldest'?a.start-b.start:b.start-a.start);
 const duration=ms=>{const mins=Math.round(ms/60000);return Math.floor(mins/60)+'h '+String(mins%60).padStart(2,'0')+'m';};
 const trips=sessions.map(x=>'<div style="padding:8px 0;border-bottom:1px solid #e3e8e6"><strong>'+escapeHtml(name(x.pet))+'</strong><div class="small">Out '+clock(x.start)+' · In '+clock(x.end)+' · '+duration(x.end-x.start)+'</div></div>').join('');
 const popupContent=graphMetric==='time'?'<p><strong>'+sessions.length+' completed outside trips</strong></p><div style="max-height:40vh;overflow:auto">'+(trips||'<p class="small">No completed trips in the available records.</p>')+'</div>' :'<p><strong>'+(graphSelectedDirection==='In'?entries+' entries':graphSelectedDirection==='Out'?exits+' exits':entries+' entries · '+exits+' exits')+'</strong></p>'+(cats||'<p>No confirmed movements recorded.</p>')+'<div style="max-height:40vh;overflow:auto">'+(rows||'<p class="small">No recorded movements for this day.</p>')+'</div>';
  let overlay=document.getElementById('pet-graph-popup');
 if(!overlay){overlay=document.createElement('div');overlay.id='pet-graph-popup';overlay.setAttribute('role','presentation');overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:14px';overlay.addEventListener('click',e=>{if(e.target===overlay)window.closePetGraphPopup();});document.body.appendChild(overlay);}
 const title=new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 overlay.innerHTML='<div role="dialog" aria-modal="true" aria-label="Activity details for '+escapeHtml(title)+'" style="background:#fff;color:#19312d;border-radius:14px;padding:18px;width:min(100%,460px);max-height:85vh;overflow:auto;box-shadow:0 10px 40px #0004"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><h3 style="margin:0">'+escapeHtml(title)+'</h3><button type="button" class="button secondary" onclick="closePetGraphPopup()" aria-label="Close activity details">Close ✕</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h4>'+(graphMetric==='time'?'Outside trips':graphSelectedDirection==='In'?'Entries':graphSelectedDirection==='Out'?'Exits':'Movement times')+'</h4><label>Order <select aria-label="Sort activity" onchange="petGraphPopupSort(this.value)"><option value="newest"'+(graphPopupSort==='newest'?' selected':'')+'>Newest first</option><option value="oldest"'+(graphPopupSort==='oldest'?' selected':'')+'>Oldest first</option></select></label></div>'+popupContent+'<p class="small">Based on retrieved confirmed events. Missing or unfinished trips are excluded.</p></div>';
 overlay.style.display='flex';overlay.querySelector('button')?.focus();
}
window.closePetGraphPopup=function(){const el=document.getElementById('pet-graph-popup');if(el)el.style.display='none';};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('pet-graph-popup')?.style.display==='flex')window.closePetGraphPopup();});
function renderGraphs(){
 const timeline=document.getElementById('timelineEvents');
 if(!timeline||!timeline.closest('.page.active'))return;
 let root=document.getElementById('pet-graphs');
 if(!root){root=document.createElement('div');root.id='pet-graphs';root.className='card';root.style.margin='12px 0';timeline.before(root);}
 const events=graphRecords().filter(e=>graphPet==='all'||e.pet===graphPet);
 const today=ukDay(new Date()),days=[];
 for(let i=graphRange-1;i>=0;i--){const d=new Date();d.setUTCDate(d.getUTCDate()-i);days.push({day:ukDay(d),ins:0,outs:0,minutes:0});}
 const byDay=new Map(days.map(d=>[d.day,d]));
 const lastOut=new Map();
 // Process chronologically, separately for each cat, so interleaved pet events do not corrupt durations.
 for(let i=events.length-1;i>=0;i--){const e=events[i],b=byDay.get(e.day);
  if(b){if(e.direction==='In')b.ins++;else b.outs++;}
  if(e.direction==='Out'){lastOut.set(e.pet,e.at);continue;}
  const start=lastOut.get(e.pet);if(start===undefined||e.at<=start)continue;
  lastOut.delete(e.pet);
  // Split sessions across UK calendar days, including daylight-saving changes.
  let t=start,guard=0;
  while(t<e.at&&guard++<35){const k=ukDay(new Date(t));let next=t+3600000;while(next<e.at&&ukDay(new Date(next))===k)next+=3600000;
   let lo=t,hi=Math.min(e.at,next);if(ukDay(new Date(hi))!==k){while(hi-lo>1000){const mid=Math.floor((lo+hi)/2);if(ukDay(new Date(mid))===k)lo=mid;else hi=mid;}}
   const end=hi===e.at?hi:hi;const row=byDay.get(k);if(row)row.minutes+=(end-t)/60000;
   t=end>t?end:t+1000;
  }
 }
 const maxMove=Math.max(1,...days.map(d=>Math.max(d.ins,d.outs))),maxTime=Math.max(1,...days.map(d=>d.minutes));
 const bar=(value,max,color,day,title,direction)=>'<button type="button" onclick="petGraphDay(&#39;'+day+'&#39;,&#39;'+direction+'&#39;)" title="'+escapeHtml(title)+'" style="display:block;width:100%;height:'+Math.max(3,Math.round(value/max*94))+'px;background:'+color+';border:0;border-radius:3px 3px 0 0;padding:0;cursor:pointer" aria-label="'+escapeHtml(title)+'"></button>';
 const bars=(kind)=>'<div style="display:flex;align-items:flex-end;gap:2px;height:112px;border-bottom:1px solid #cbd9d4;overflow-x:auto;overflow-y:hidden;touch-action:pan-x">'+days.map(d=>kind==='move'?'<div style="flex:1 0 '+(graphRange===28?'21px':'34px')+';display:flex;gap:2px;align-items:flex-end;height:100%;min-width:0"><div style="flex:1;min-width:9px">'+bar(d.ins,maxMove,'#178f99',d.day,d.day+': '+d.ins+' entries','In')+'</div><div style="flex:1;min-width:9px">'+bar(d.outs,maxMove,'#e49a46',d.day,d.day+': '+d.outs+' exits','Out')+'</div></div>':'<div style="flex:1 0 '+(graphRange===28?'28px':'40px')+';min-width:0">'+bar(d.minutes,maxTime,'#5d7ec3',d.day,d.day+': '+Math.round(d.minutes)+' minutes outside','all')+'</div>').join('')+'</div>';
 const selected=byDay.get(graphSelected)||days[days.length-1];
 const opts=['all',...names.map(n=>n.toLowerCase())].map(n=>'<option value="'+escapeHtml(n)+'"'+(graphPet===n?' selected':'')+'>'+(n==='all'?'All cats':escapeHtml(n.charAt(0).toUpperCase()+n.slice(1)))+'</option>').join('');
 root.innerHTML='<h3 style="margin-top:0">Cat activity</h3><div class="row" style="gap:8px;flex-wrap:wrap"><label>View <select aria-label="Graph metric" onchange="petGraphMetric(this.value)"><option value="move"'+(graphMetric==='move'?' selected':'')+'>Entries and exits</option><option value="time"'+(graphMetric==='time'?' selected':'')+'>Time outside</option></select></label><label>Cat <select onchange="petGraphPet(this.value)">'+opts+'</select></label><button class="button secondary" onclick="petGraphRange(7)" '+(graphRange===7?'aria-pressed="true"':'')+'>7 days</button><button class="button secondary" onclick="petGraphRange(28)" '+(graphRange===28?'aria-pressed="true"':'')+'>28 days</button></div><h4>'+(graphMetric==='move'?'Entries and exits':'Time spent outside')+'</h4>'+bars(graphMetric)+'<p class="small">'+(graphMetric==='move'?'Blue: entries · Orange: exits':'Blue: minutes outside between confirmed exit and return')+'</p><div class="small">'+escapeHtml(days[0].day)+' to '+escapeHtml(today)+'</div><p class="small">Tap a bar for '+(graphMetric==='move'?'movement times':'individual trip durations')+'. Only retrieved confirmed events are included; incomplete history may affect totals.</p>';
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
const mount=()=>{const home=document.getElementById('home');const stats=home?.querySelector('.stats');if(stats){stats.insertAdjacentElement('afterend',section);}else if(home){home.prepend(section);}else{document.body.prepend(section);}};
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
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();paint();refresh();refreshCloud();});else{mount();refresh();refreshCloud();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){paint();refresh();refreshCloud();}});
setInterval(refresh,5000);setInterval(refreshCloud,60000);
})();
