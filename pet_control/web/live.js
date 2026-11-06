(function(){
const names=['Jessie','Henry','Rosie','Violet'];
const section=document.createElement('section');
section.className='card';section.style.cssText='margin-top:14px;background:#fff;color:#19312d;width:100%;';
section.innerHTML='<strong>Live Sure Petcare status</strong><div id="pet-live-list" style="margin-top:8px">Connecting to Home Assistant…</div><small id="pet-live-time"></small>';
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ukDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const dayKey=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return ukDay(d);};
let activity=[];let loaded=false;let pending=null;let lastFetched=0;
try{const saved=JSON.parse(sessionStorage.getItem('pet-sure-activity')||'null');if(saved&&Array.isArray(saved.events)){activity=saved.events;loaded=true;}}catch{}
function direction(e){
 const raw=e.details||{};
 const value=String(raw.direction??raw.movement??raw.position??raw.state??raw.where??'').toLowerCase();
 if(['in','inside','home','entered','entry','1'].includes(value))return 'In';
 if(['out','outside','away','left','exit','2'].includes(value))return 'Out';
 return 'Unknown';
}
function records(){return activity.flatMap(e=>(e.pets||[]).filter(p=>names.some(n=>n.toLowerCase()===p)).map(p=>({...e,pet:p,direction:direction(e)}))).sort((a,b)=>new Date(b.at)-new Date(a.at));}
function iconFor(e){return e.direction==='In'?'↙':e.direction==='Out'?'↗':'↔';}
function labelFor(e){return e.direction==='In'?'Entered':e.direction==='Out'?'Left':'Activity recorded';}
function rowFor(e,fullDate=false){
 const name=names.find(n=>n.toLowerCase()===e.pet)||e.pet;
 const time=new Date(e.at).toLocaleString('en-GB',{timeZone:'Europe/London',...(fullDate?{day:'numeric',month:'short'}:{}),hour:'2-digit',minute:'2-digit'});
 return '<div class="listrow"><div class="row"><div class="eventicon" aria-label="'+labelFor(e)+'">'+iconFor(e)+'</div><div><strong>'+escapeHtml(name)+'</strong><div class="small">'+labelFor(e)+'</div></div></div><span class="small">'+time+'</span></div>';
}
function paint(){
 const box=document.getElementById('homeEvents'),count=document.getElementById('countEvents');
 if(box&&count){
  const today=ukDay(new Date()),todayEvents=records().filter(e=>ukDay(new Date(e.at))===today);
  count.textContent=loaded?String(todayEvents.length):'–';
  box.style.maxHeight='330px';box.style.overflowY='auto';box.style.overscrollBehavior='contain';
  if(loaded)box.innerHTML=todayEvents.length?todayEvents.map(e=>rowFor(e)).join(''):'<div class="empty">No activity recorded today.</div>';
 }
 if(typeof window.renderSureTimeline==='function')window.renderSureTimeline();
}
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
 count.textContent=loaded?list.length+' activities · '+list.filter(e=>e.direction==='In').length+' in · '+list.filter(e=>e.direction==='Out').length+' out · '+list.filter(e=>e.direction==='Unknown').length+' unclassified':'Loading activity…';
 target.style.maxHeight='65vh';target.style.overflowY='auto';
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
   try{sessionStorage.setItem('pet-sure-activity',JSON.stringify({events:activity}));}catch{}
  }catch{if(!loaded){const box=document.getElementById('homeEvents');if(box)box.innerHTML='<div class="empty">Sure Petcare activity unavailable.</div>';}}
  finally{pending=null;paint();}
 })();
 return pending;
}
const mount=()=>{const home=document.getElementById('home');const stats=home?.querySelector('.stats');if(stats){stats.insertAdjacentElement('afterend',section);}else if(home){home.prepend(section);}else{document.body.prepend(section);}};
async function refresh(){
try{const r=await fetch('./live/status',{cache:'no-store'});if(!r.ok)throw Error('unavailable');const d=await r.json();
document.getElementById('pet-live-list').innerHTML=names.map(n=>{const p=d.pets.find(x=>x.name===n.toLowerCase());const status=p?.state==='on'?'Home':p?.state==='off'?'Away':'Unknown';return '<div style="display:flex;justify-content:space-between;padding:5px 0"><span>'+n+'</span><strong>'+status+'</strong></div>'}).join('');
document.getElementById('pet-live-time').textContent='Updated '+new Date(d.updated).toLocaleTimeString('en-GB');
document.querySelectorAll('#homePets .pet-tap').forEach(card=>{const name=card.querySelector('.petname')?.textContent?.trim();const p=d.pets.find(x=>x.name===name?.toLowerCase());if(!p)return;const pill=card.querySelector('.pill');const detail=card.querySelector('.small');const status=p.state==='on'?'Home':p.state==='off'?'Away':'Unknown';if(pill){pill.textContent=status;pill.classList.toggle('out',status==='Away');}if(detail){detail.innerHTML=detail.innerHTML.replace(/Sample status only|Awaiting live status/g,'Live status from Sure Petcare');}});
}catch(e){document.getElementById('pet-live-list').textContent='Live status unavailable. Check Home Assistant app logs.';}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();paint();refresh();refreshCloud();});else{mount();refresh();refreshCloud();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){paint();refresh();refreshCloud();}});
setInterval(refresh,30000);setInterval(refreshCloud,60000);
})();
