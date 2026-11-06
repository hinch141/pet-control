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
  const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','manifest.webmanifest','sw.js','live.js'].includes(filename)){res.writeHead(404);return res.end();}
  const file=path.join(base,filename);
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(body);});
});
server.listen(80,'0.0.0.0');
