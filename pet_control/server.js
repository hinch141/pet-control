'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const base='/usr/share/pet-control';
const pets=['jessie','henry','rosie','violet'];
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8'};
const token=process.env.SUPERVISOR_TOKEN;
let activitySnapshot=null,activityPending=null;
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
  if(url.pathname==='/sure/activity'){
    const send=(status,detail)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({status,...detail}));};
    if(activitySnapshot&&Date.now()-activitySnapshot.at<120000)return send(activitySnapshot.status,activitySnapshot.detail);
    let opts={};try{opts=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(opts.sure_email||'').trim(),password=String(opts.sure_password||'');
    if(!email||!password)return send('not_configured',{events:[],total:0});
    try{
      const deviceId=randomUUID();
      const headers={'Accept':'application/json','Content-Type':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const authRes=await fetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!authRes.ok)return send('authentication_error',{events:[],total:0});
      const auth=await authRes.json();const access=auth.data?.token||auth.token;
      if(!access)return send('authentication_error',{events:[],total:0});
      headers.Authorization='Bearer '+access;
      const homeRes=await fetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
      if(!homeRes.ok)return send('household_error',{events:[],total:0});
      const home=await homeRes.json();const hs=home.data?.households||home.data?.household||home.households||[];
      const house=Array.isArray(hs)?hs[0]:hs;const houseId=house?.id||home.data?.household_id||home.data?.household?.id;
      if(!houseId)return send('household_error',{events:[],total:0});
      // Probe pagination methods without assuming that Sure Petcare honours ?page=.
      // Keep the working first page, and only continue with a method that yields older unique events.
      const items=[],cutoff=Date.now()-183*86400000,seenIds=new Set();
      let historyComplete=false,historyError=false,pagesFetched=0,stopReason='page_limit';
      let firstPageOldest=null,lastPageOldest=null,paginationMethod='unconfirmed';
      const paginationTests=[];
      const base='https://app.api.surehub.io/api/timeline/household/'+encodeURIComponent(houseId);
      const extract=body=>Array.isArray(body)?body:Array.isArray(body?.data)?body.data:Array.isArray(body?.data?.entries)?body.data.entries:null;
      const getPage=async url=>{
        try{
          const response=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
          if(!response.ok)return {error:'http_'+response.status};
          const body=await response.json(),batch=extract(body);
          if(!batch)return {error:'unexpected_response'};
          return {batch};
        }catch{return {error:'request_failed'};}
      };
      const ingest=batch=>{
        let fresh=0;
        for(const e of batch){
          const id=String(e.id??'')||String(e.created_at||'')+'|'+String(e.type||'')+'|'+JSON.stringify(e.pets||[]);
          if(seenIds.has(id))continue;
          seenIds.add(id);items.push(e);fresh++;
        }
        return fresh;
      };
      const first=await getPage(base+'?page=0');
      if(first.error){historyError=true;stopReason=first.error;}
      else{
        pagesFetched++;
        ingest(first.batch);
        firstPageOldest=first.batch.at(-1)?.created_at||null;
        lastPageOldest=firstPageOldest;
        if(!first.batch.length){historyComplete=true;stopReason='empty_page';}
        else{
          const oldest=first.batch.map(e=>Date.parse(e.created_at)).filter(Number.isFinite).reduce((a,b)=>Math.min(a,b),Infinity);
          const tests=[
            {name:'page_1',url:base+'?page=1'},
            {name:'page_2',url:base+'?page=2'},
            {name:'offset_33',url:base+'?offset='+first.batch.length+'&limit='+first.batch.length},
            {name:'before_timestamp',url:base+'?before='+encodeURIComponent(new Date(oldest-1000).toISOString())},
            {name:'date_before',url:base+'?date='+encodeURIComponent(new Date(oldest-86400000).toISOString().slice(0,10))}
          ];
          let chosen=null;
          for(const test of tests){
            const result=await getPage(test.url);
            pagesFetched++;
            if(result.error){paginationTests.push({method:test.name,result:result.error});continue;}
            const fresh=result.batch.filter(e=>!seenIds.has(String(e.id??'')||String(e.created_at||'')+'|'+String(e.type||'')+'|'+JSON.stringify(e.pets||[])));
            const older=fresh.filter(e=>Number.isFinite(Date.parse(e.created_at))&&Date.parse(e.created_at)<oldest);
            paginationTests.push({method:test.name,result:older.length?'older_events':fresh.length?'new_events':result.batch.length?'repeated_page':'empty_page',count:result.batch.length,older:older.length});
            if(older.length){chosen=test.name;paginationMethod=chosen;ingest(result.batch);lastPageOldest=result.batch.at(-1)?.created_at||lastPageOldest;break;}
          }
          if(!chosen){stopReason='no_working_pagination';historyError=true;}
          else{
            // Follow only verified methods. Stop on repeated pages or the six-month boundary.
            for(let page=chosen==='page_2'?3:2;page<80;page++){
              const earliest=items.map(e=>Date.parse(e.created_at)).filter(Number.isFinite).reduce((a,b)=>Math.min(a,b),Infinity);
              if(earliest<cutoff){historyComplete=true;stopReason='six_month_boundary';break;}
              let url;
              if(chosen.startsWith('page_'))url=base+'?page='+page;
              else if(chosen==='offset_33')url=base+'?offset='+(page*first.batch.length)+'&limit='+first.batch.length;
              else if(chosen==='before_timestamp')url=base+'?before='+encodeURIComponent(new Date(earliest-1000).toISOString());
              else url=base+'?date='+encodeURIComponent(new Date(earliest-86400000).toISOString().slice(0,10));
              const result=await getPage(url);pagesFetched++;
              if(result.error){historyError=true;stopReason=result.error;break;}
              if(!result.batch.length){historyComplete=true;stopReason='empty_page';break;}
              const fresh=ingest(result.batch);
              lastPageOldest=result.batch.at(-1)?.created_at||lastPageOldest;
              if(!fresh){stopReason='repeated_page';break;}
              if(page===79)stopReason='request_limit';
            }
          }
        }
      }
      if(!items.length&&historyError)return send('timeline_error',{events:[],total:0});
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
      try{
        const file='/data/sure-activity-cache.json';let saved=[];try{saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(saved))saved=[];}catch{}
        const map=new Map(saved.map(e=>[e.id,e]));for(const e of events)if(e.id)map.set(e.id,e);
        const merged=[...map.values()].filter(e=>Number.isFinite(Date.parse(e.at))).sort((a,b)=>new Date(b.at)-new Date(a.at));
        fs.writeFileSync(file,JSON.stringify(merged),{mode:0o600});
        const detail={events:merged,total:merged.length,historyComplete,historyError,pagesFetched,stopReason,paginationMethod,paginationTests,firstPageOldest,lastPageOldest,oldestEvent:merged.at(-1)?.at||null,source:'Sure Petcare timeline; six-month backfill with long-term local retention'};
        activitySnapshot={at:Date.now(),status:'connected',detail};
        return send('connected',detail);
      }catch{return send('connected_no_cache',{events,total:events.length,historyComplete,historyError,pagesFetched,stopReason,paginationMethod,paginationTests});}
    }catch{return send('connection_error',{events:[],total:0});}
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
