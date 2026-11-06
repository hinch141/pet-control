'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
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
      const start=new Date(Date.now()-24*60*60*1000).toISOString();
      const ids=pets.map(p=>'binary_sensor.'+p).join(',');
      const endpoint='http://supervisor/core/api/history/period/'+encodeURIComponent(start)+'?filter_entity_id='+encodeURIComponent(ids)+'&minimal_response';
      const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('Home Assistant history returned '+response.status);
      const histories=await response.json();
      if(!Array.isArray(histories))throw Error('Invalid history');
      const events=[];
      for(const records of histories){
        if(!Array.isArray(records)||!records.length)continue;
        let previous=null;
        for(let i=0;i<records.length;i++){
          const item=records[i],id=item.entity_id||records[0].entity_id;
          const name=String(id||'').replace('binary_sensor.','');
          if(!pets.includes(name))continue;
          const state=item.state;
          if(state!=='on'&&state!=='off'){previous=state;continue;}
          const timestamp=item.last_changed||item.last_updated;
          if(!timestamp)continue;
          if(i>0&&state!==previous)events.push({name,state,at:timestamp});
          previous=state;
        }
      }
      events.sort((a,b)=>new Date(b.at)-new Date(a.at));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({events:events.slice(0,30),periodHours:24}));
    }catch(e){res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Unable to read movement history'}));}
  }
  const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','manifest.webmanifest','sw.js','live.js'].includes(filename)){res.writeHead(404);return res.end();}
  const file=path.join(base,filename);
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(body);});
});
server.listen(80,'0.0.0.0');
