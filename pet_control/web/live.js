(function(){
const names=['Jessie','Henry','Rosie','Violet'];
const section=document.createElement('section');
section.style.cssText='margin:18px 24px;padding:16px;background:#e4efe8;border-radius:16px;color:#183a32';
section.innerHTML='<strong>Live Sure Petcare status</strong><div id="pet-live-list" style="margin-top:8px">Connecting to Home Assistant…</div><small id="pet-live-time"></small>';
const mount=()=>{const el=document.querySelector('.banner')||document.querySelector('main')||document.body;el.parentNode.insertBefore(section,el.nextSibling)};
async function refresh(){
try{const r=await fetch('./live/status',{cache:'no-store'});if(!r.ok)throw Error('unavailable');const d=await r.json();
document.getElementById('pet-live-list').innerHTML=names.map(n=>{const p=d.pets.find(x=>x.name===n.toLowerCase());const status=p?.state==='on'?'Home':p?.state==='off'?'Away':'Unknown';return '<div style="display:flex;justify-content:space-between;padding:5px 0"><span>'+n+'</span><strong>'+status+'</strong></div>'}).join('');
document.getElementById('pet-live-time').textContent='Updated '+new Date(d.updated).toLocaleTimeString('en-GB');
}catch(e){document.getElementById('pet-live-list').textContent='Live status unavailable. Check Home Assistant app logs.';}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();refresh();});else{mount();refresh();}
setInterval(refresh,30000);
})();
