(function(){
'use strict';
const panel=document.getElementById('petReliabilityResults');
const button=document.getElementById('petReliabilityButton');
if(!panel||!button)return;
const safe=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function age(ms){return ms==null?'Unknown':ms<60000?Math.round(ms/1000)+' sec':Math.round(ms/60000)+' min';}
button.addEventListener('click',async()=>{
 button.disabled=true;panel.textContent='Reading local diagnostics…';
 try{
  const r=await fetch('./pet-hq/reliability',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('Diagnostic service unavailable');
  const d=await r.json();
  if(!Array.isArray(d.recent))throw Error('Invalid diagnostic response');
  panel.innerHTML='<p class="small">Latest '+d.recent.length+' checks (stored in memory; cleared on restart). No additional Sure Petcare requests are made.</p>'+
   (d.recent.length?d.recent.map(x=>'<div class="listrow"><div><strong>'+safe(x.source)+' · '+safe(x.operation)+'</strong><div class="small">'+safe(new Date(x.at).toLocaleString('en-GB'))+' · '+safe(x.durationMs)+' ms · Source age '+safe(age(x.sourceAgeMs))+'</div></div><strong>'+safe(x.ok?'OK':'Failed')+'</strong></div>').join(''):'<p class="small">No readings yet. Use Pet HQ normally and check again.</p>');
 }catch(e){panel.textContent='Could not read diagnostics. '+String(e.message||'').slice(0,100);}
 finally{button.disabled=false;}
});
})();
