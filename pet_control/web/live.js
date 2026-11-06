(function(){
const names=['Jessie','Henry','Rosie','Violet'];
const section=document.createElement('section');
section.className='card';section.style.cssText='margin-top:14px;background:#fff;color:#19312d;width:100%;';
section.innerHTML='<strong>Live Sure Petcare status</strong><div id="pet-live-list" style="margin-top:8px">Connecting to Home Assistant…</div><small id="pet-live-time"></small>';
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ukDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
async function refreshCloud(){
 const box=document.getElementById('homeEvents'),count=document.getElementById('countEvents');
 if(!box||!count)return;
 try{
  const r=await fetch('./sure/activity',{cache:'no-store'});if(!r.ok)throw Error('unavailable');
  const data=await r.json();if(!String(data.status).startsWith('connected'))throw Error(data.status);
  const today=ukDay(new Date());
  const events=(data.events||[]).filter(e=>ukDay(new Date(e.at))===today&&Array.isArray(e.pets)&&e.pets.length);
  count.textContent=String(events.length);
  box.style.cssText+=';max-height:330px;overflow-y:auto;overscroll-behavior:contain;';
  box.innerHTML=events.length?events.map(e=>{
    const name=e.pets.map(p=>names.find(n=>n.toLowerCase()===p)||p).join(', ');
    const time=new Date(e.at).toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'});
    return '<div class="listrow"><div class="row"><div class="eventicon">🐾</div><div><strong>'+escapeHtml(name)+'</strong><div class="small">Sure Petcare activity</div></div></div><span class="small">'+time+'</span></div>';
  }).join(''):'<div class="empty">No pet activity recorded today.</div>';
 }catch(e){count.textContent='–';box.innerHTML='<div class="empty">Sure Petcare activity temporarily unavailable.</div>';}
}
const mount=()=>{const home=document.getElementById('home');const stats=home?.querySelector('.stats');if(stats){stats.insertAdjacentElement('afterend',section);}else if(home){home.prepend(section);}else{document.body.prepend(section);}};
async function refresh(){
try{const r=await fetch('./live/status',{cache:'no-store'});if(!r.ok)throw Error('unavailable');const d=await r.json();
document.getElementById('pet-live-list').innerHTML=names.map(n=>{const p=d.pets.find(x=>x.name===n.toLowerCase());const status=p?.state==='on'?'Home':p?.state==='off'?'Away':'Unknown';return '<div style="display:flex;justify-content:space-between;padding:5px 0"><span>'+n+'</span><strong>'+status+'</strong></div>'}).join('');
document.getElementById('pet-live-time').textContent='Updated '+new Date(d.updated).toLocaleTimeString('en-GB');
document.querySelectorAll('#homePets .pet-tap').forEach(card=>{const name=card.querySelector('.petname')?.textContent?.trim();const p=d.pets.find(x=>x.name===name?.toLowerCase());if(!p)return;const pill=card.querySelector('.pill');const detail=card.querySelector('.small');const status=p.state==='on'?'Home':p.state==='off'?'Away':'Unknown';if(pill){pill.textContent=status;pill.classList.toggle('out',status==='Away');}if(detail){detail.innerHTML=detail.innerHTML.replace(/Sample status only|Awaiting live status/g,'Live status from Sure Petcare');}});
}catch(e){document.getElementById('pet-live-list').textContent='Live status unavailable. Check Home Assistant app logs.';}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();refresh();refreshCloud();});else{mount();refresh();refreshCloud();}
setInterval(refresh,30000);setInterval(refreshCloud,60000);
})();
