'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const base='/usr/share/pet-control';
const pets=['jessie','henry','rosie','violet'];
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8'};
const token=process.env.SUPERVISOR_TOKEN;
const server=http.createServer(async(req,res)=>{
  const peer=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  if(peer!=='172.30.32.2'){res.writeHead(403);return res.end();}
  const url=new URL(req.url,'http://localhost');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(url.pathname==='/sure/diagnostic'){
    let options={};
    try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
    const output=(status,detail)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({status,detail}));};
    if(!email||!password)return output('not_configured','Add Sure Petcare email and password in the Pet Control app Configuration tab.');
    try{
      const deviceId=randomUUID();
      const baseHeaders={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const login=await fetch('https://app.api.surehub.io/api/auth/login',{
        method:'POST',headers:baseHeaders,
        body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)return output('login_failed','Sure Petcare authentication returned HTTP '+login.status+'. No credentials were logged.');
      const auth=await login.json();
      const access=auth.token||auth.access_token||auth.data?.token||auth.data?.access_token;
      if(typeof access!=='string'||!access)return output('unknown_login_format','Authentication returned an unexpected token format.');
      const headers={...baseHeaders,Authorization:'Bearer '+access};
      const start=await fetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
      if(!start.ok)return output('household_failed','Authenticated, but household lookup returned HTTP '+start.status+'.');
      const household=await start.json();
      const households=household.data?.households||household.data?.household||household.households||[];
      const first=Array.isArray(households)?households[0]:households;
      const householdId=first?.id||household.data?.household_id||household.data?.household?.id;
      if(!householdId)return output('login_connected','Authentication works. Household response structure needs adapting for timeline.');
      const endpoint='https://app.api.surehub.io/api/timeline/household/'+encodeURIComponent(householdId)+'?page=0';
      const timeline=await fetch(endpoint,{headers,signal:AbortSignal.timeout(12000)});
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
  if(url.pathname==='/live/status'){
    if(!token){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Home Assistant access unavailable'}));}
    try{
      const result=await Promise.all(pets.map(async p=>{
        const response=await fetch('http://supervisor/core/api/states/binary_sensor.'+p,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw Error('Home Assistant returned '+response.status);
        const data=await response.json();
        return {name:p,state:data.state,changed:data.last_changed};
      }));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({pets:result,updated:new Date().toISOString()}));
    }catch(e){res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Unable to read pet status'}));}
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
  if(!['index.html','manifest.webmanifest','sw.js','live.js'].includes(filename)){res.writeHead(404);return res.end();}
  const file=path.join(base,filename);
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(body);});
});
server.listen(80,'0.0.0.0');
