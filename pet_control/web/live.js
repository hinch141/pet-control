(function(){
const names=['Jessie','Henry','Rosie','Violet'];
const section=document.createElement('section');
section.className='card';section.style.cssText='margin-top:14px;background:#fff;color:#19312d;width:100%;';
section.innerHTML='<strong>Live Sure Petcare status</strong><div id="pet-live-list" style="margin-top:8px">Connecting to Home Assistant…</div><small id="pet-live-time"></small>';
const mount=()=>{const home=document.getElementById('home');const stats=home?.querySelector('.stats');if(stats){stats.insertAdjacentElement('afterend',section);}else if(home){home.prepend(section);}else{document.body.prepend(section);}};
async function refreshHistory(){
 const box=document.getElementById('homeEvents');
 if(!box)return;
 try{
   const response=await fetch('./live/history',{cache:'no-store'});
   if(!response.ok)throw Error('History unavailable');
   const data=await response.json();
   if(!Array.isArray(data.events))throw Error('Invalid history');
   window.petLiveHistoryLoaded=true;document.getElementById('countEvents').textContent=String(data.events.length);
   box.innerHTML=data.events.length?data.events.map(e=>{
     const label=e.state==='on'?'Came inside':'Went outside';
     const date=new Date(e.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
     const name=names.find(n=>n.toLowerCase()===e.name)||'Pet';
     return '<div class="listrow"><div class="row"><div class="eventicon">'+(e.state==='on'?'↙':'↗')+'</div><div><strong>'+name+'</strong><div class="small">'+label+' · live history</div></div></div><span class="small">'+date+'</span></div>';
   }).join(''):'<div class="empty">No recorded movements in the last 24 hours.</div>';
 }catch(e){window.petLiveHistoryLoaded=true;document.getElementById('countEvents').textContent='–';box.innerHTML='<div class="empty">Movement history unavailable. Live Home/Away status is still available above.</div>';}
}
async function refresh(){
try{const r=await fetch('./live/status',{cache:'no-store'});if(!r.ok)throw Error('unavailable');const d=await r.json();
document.getElementById('pet-live-list').innerHTML=names.map(n=>{const p=d.pets.find(x=>x.name===n.toLowerCase());const status=p?.state==='on'?'Home':p?.state==='off'?'Away':'Unknown';return '<div style="display:flex;justify-content:space-between;padding:5px 0"><span>'+n+'</span><strong>'+status+'</strong></div>'}).join('');
document.getElementById('pet-live-time').textContent='Updated '+new Date(d.updated).toLocaleTimeString('en-GB');
document.querySelectorAll('#homePets .pet-tap').forEach(card=>{const name=card.querySelector('.petname')?.textContent?.trim();const p=d.pets.find(x=>x.name===name?.toLowerCase());if(!p)return;const pill=card.querySelector('.pill');const detail=card.querySelector('.small');const status=p.state==='on'?'Home':p.state==='off'?'Away':'Unknown';if(pill){pill.textContent=status;pill.classList.toggle('out',status==='Away');}if(detail){detail.innerHTML=detail.innerHTML.replace(/Sample status only|Awaiting live status/g,'Live status from Sure Petcare');}});
}catch(e){document.getElementById('pet-live-list').textContent='Live status unavailable. Check Home Assistant app logs.';}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();refresh();refreshHistory();});else{mount();refresh();refreshHistory();}
setInterval(refresh,30000);setInterval(refreshHistory,60000);
})();
