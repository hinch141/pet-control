(function(){
const names=['Jessie','Henry','Rosie','Violet'];
const section=document.createElement('section');
section.className='card';section.style.cssText='margin-top:14px;background:#fff;color:#19312d;width:100%;';
section.innerHTML='<strong>Live Sure Petcare status</strong><div id="pet-live-list" style="margin-top:8px">Connecting to Home Assistant…</div><small id="pet-live-time"></small>';
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ukDay=d=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
const dayKey=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return ukDay(d);};
let activity=[];let loaded=false;let pending=null;let lastFetched=0;
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
function records(){return activity.filter(e=>e.type===0).flatMap(e=>(e.pets||[]).filter(p=>names.some(n=>n.toLowerCase()===p)).map(p=>({...e,pet:p,direction:direction(e)}))).sort((a,b)=>new Date(b.at)-new Date(a.at));}
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
  if(loaded)box.innerHTML=todayEvents.length?todayEvents.map(e=>rowFor(e)).join(''):'<div class="empty">No activity recorded today.</div>';
 }
 if(typeof window.renderSureTimeline==='function')window.renderSureTimeline();
 if(typeof window.renderSurePetDetail==='function')window.renderSurePetDetail();
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
 if(!target||!count)return;
 const offset=typeof dayOffset==='number'?dayOffset:0;
 const date=new Date();date.setDate(date.getDate()+offset);
 const key=ukDay(date);
 const filter=document.getElementById('filterPet')?.value||'all',type=document.getElementById('filterType')?.value||'all';
 const list=records().filter(e=>ukDay(new Date(e.at))===key&&(filter==='all'||e.pet===String((state.pets||[]).find(p=>p.id===filter)?.name||'').toLowerCase())&&(type==='all'||e.direction===type));
 document.getElementById('selectedDayLabel').textContent=offset===0?'Today':offset===-1?'Yesterday':date.toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'long'});
 document.getElementById('selectedDayDate').textContent=date.toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'long',year:'numeric'});
 document.getElementById('prevDay').disabled=offset<=-30;document.getElementById('nextDay').disabled=offset>=0;document.getElementById('todayButton').style.display=offset===0?'none':'block';
 count.textContent=loaded?list.filter(e=>e.direction!=='Unknown').length+' confirmed movements · '+list.filter(e=>e.direction==='In').length+' in · '+list.filter(e=>e.direction==='Out').length+' out · '+list.filter(e=>e.direction==='Unknown').length+' needing verification':'Loading activity…';
 target.style.maxHeight='65vh';target.style.overflowY='auto';
 if(!document.getElementById('movement-check-button')){const btn=document.createElement('button');btn.id='movement-check-button';btn.className='button secondary';btn.textContent='Check movement data';btn.style.margin='8px 0';btn.onclick=()=>{let panel=document.getElementById('movement-check-results');if(!panel){panel=document.createElement('div');panel.id='movement-check-results';panel.className='card';btn.after(panel);}const sample=activity.slice(0,25).map(e=>({time:new Date(e.at).toLocaleString('en-GB'),type:e.type,pets:e.pets,details:e.details,interpreted:direction(e)}));panel.innerHTML='<strong>Sure Petcare movement check (latest 25)</strong><p class="small">These are event types and movement fields returned by Sure Petcare, with no account credentials or identifiers. Please share a screenshot to verify the mapping.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px">'+escapeHtml(JSON.stringify(sample,null,2))+'</pre>';};target.before(btn);}
 target.innerHTML=!loaded?'<div class="empty">Loading live Sure Petcare activity…</div>':list.length?list.map(e=>rowFor(e,true)).join(''):'<div class="empty">No matching activity recorded for this day.</div>';
};
async function refreshCloud(force=false){
 if(pending)return pending;
 if(!force&&Date.now()-lastFetched<30000){paint();return;}
 pending=(async()=>{
  try{
   const r=await fetch('./sure/activity',{cache:'no-store'});if(!r.ok)throw Error('unavailable');
   const data=await r.json();if(!String(data.status).startsWith('connected'))throw Error(data.status);
   activity=data.events||[];loaded=true;lastFetched=Date.now();
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
