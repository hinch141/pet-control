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
  if(url.pathname==='/live/flap/mode'&&req.method==='POST'){
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    if(!token)return reply(503,{error:'Home Assistant connection unavailable'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'JSON required'});
    try{
      let raw='';
      for await(const chunk of req){raw+=chunk;if(raw.length>512)return reply(413,{error:'Request too large'});}
      const body=JSON.parse(raw),mode=body.mode;
      if(mode!=='normal'&&mode!=='indoor_only')return reply(400,{error:'Invalid mode'});
      const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
      const entity='lock.my_flap_locked_out';
      const before=await fetch('http://supervisor/core/api/states/'+entity,{headers,signal:AbortSignal.timeout(6000)});
      if(!before.ok)return reply(502,{error:'Unable to check current flap state'});
      const current=String((await before.json()).state);
      if(current!=='locked'&&current!=='unlocked')return reply(409,{error:'Flap state unknown; no command sent'});
      const desired=mode==='indoor_only'?'locked':'unlocked';
      if(current!==desired){
        const action=mode==='indoor_only'?'lock':'unlock';
        const call=await fetch('http://supervisor/core/api/services/lock/'+action,{
          method:'POST',headers,body:JSON.stringify({entity_id:entity}),signal:AbortSignal.timeout(8000)});
        if(!call.ok)return reply(502,{error:'Home Assistant did not accept the command'});
      }
      // A successful service call alone does not establish the physical flap state.
      for(let attempt=0;attempt<3;attempt++){
        const check=await fetch('http://supervisor/core/api/states/'+entity,{headers,signal:AbortSignal.timeout(6000)});
        if(check.ok){
          const actual=String((await check.json()).state);
          if(actual===desired)return reply(200,{status:'confirmed',mode,state:actual});
        }
        if(attempt<2)await new Promise(resolve=>setTimeout(resolve,900));
      }
      return reply(202,{status:'pending',message:'Command sent, but the flap state has not yet been confirmed'});
    }catch{return reply(502,{error:'Unable to confirm flap command. Check Home Assistant.'});}
  }
  if(url.pathname==='/sure/pet-permission-test'&&req.method==='POST'){
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(body));};
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'JSON required'});
    let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>256)return reply(413,{error:'Request too large'});}}catch{return reply(400,{error:'Invalid request'});}
    let request;try{request=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
    if(request.pet!=='Jessie'||request.confirm!=='TEST_JESSIE_AND_RESTORE')return reply(400,{error:'Only the explicitly confirmed Jessie test is available'});
    if(globalThis.petPermissionTestBusy)return reply(409,{error:'A test is already running'});
    globalThis.petPermissionTestBusy=true;
    let restore=null,stage='checking',beforeProfiles=null,readProfiles=null,readDashboard=null,writeAttempted=false,writeHttpStatus=null;
    try{
      let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
      const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
      if(!email||!password)return reply(503,{error:'Sure Petcare is not configured'});
      const deviceId=randomUUID();
      const headers={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const login=await fetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)throw Error('Sure Petcare login failed');
      const auth=await login.json(),access=auth.data?.token||auth.token||auth.access_token||auth.data?.access_token;
      if(typeof access!=='string'||!access)throw Error('Sure Petcare token unavailable');
      headers.Authorization='Bearer '+access;
      const dashboard=async()=>{
        const response=await fetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw Error('Unable to verify individual permissions');
        return (await response.json()).data||{};
      };
      readDashboard=dashboard;
      const initial=await dashboard();
      const flaps=(Array.isArray(initial.devices)?initial.devices:[]).filter(d=>[6,13].includes(Number(d.product_id)));
      const cats=Array.isArray(initial.pets)?initial.pets:[];
      const jessies=cats.filter(p=>String(p.name||'').trim().toLowerCase()==='jessie');
      if(jessies.length!==1)throw Error('Jessie cannot be uniquely identified');
      const matches=flaps.flatMap(d=>(Array.isArray(d.tags)?d.tags:[]).filter(t=>String(t.id)===String(jessies[0].tag_id)).map(t=>({device:d,tag:t})));
      if(matches.length!==1)throw Error('Jessie does not have one unique flap tag');
      const chosen=matches[0],original=Number(chosen.tag.profile);
      if(original!==2)throw Error('Jessie must start with verified Free Access (profile 2)');
      const device=Number(chosen.device.id),tag=Number(chosen.tag.tag_id??chosen.tag.id);
      if(!Number.isSafeInteger(device)||!Number.isSafeInteger(tag)||device<=0||tag<=0)throw Error('Invalid flap tag identifiers');
      const url='https://app.api.surehub.io/api/device/'+device+'/tag/'+tag;
      const setProfile=async profile=>{
        const response=await fetch(url,{method:'PUT',headers,body:JSON.stringify({profile}),signal:AbortSignal.timeout(12000)});
        writeHttpStatus=response.status;
        if(!response.ok)throw Error('Sure Petcare rejected profile update (HTTP '+response.status+')');
      };
      // Arm restoration before the first write: even a timed-out PUT may have been applied.
      restore=()=>setProfile(2);
      stage='restricting';
      writeAttempted=true;
      await setProfile(3);
      const profiles=data=>(Array.isArray(data.pets)?data.pets:[]).map(p=>{
        const ms=(Array.isArray(data.devices)?data.devices:[]).filter(d=>[6,13].includes(Number(d.product_id))).flatMap(d=>(Array.isArray(d.tags)?d.tags:[]).filter(t=>String(t.id)===String(p.tag_id)));
        return {name:String(p.name||''),profile:ms.length===1?Number(ms[0].profile):null};
      });
      readProfiles=profiles;
      beforeProfiles=profiles(initial);
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const getJessie=rows=>rows.filter(p=>p.name.trim().toLowerCase()==='jessie');
      // The Sure Petcare dashboard can report an old value immediately after a write.
      // Require two consecutive fresh confirmations, separated by several seconds.
      stage='verifying_indoor_only';
      let during=[],restrictedConfirmed=false,unchanged=false,restrictedStreak=0;
      for(let attempt=0;attempt<6;attempt++){
        await sleep(3000);
        during=profiles(await dashboard());
        unchanged=beforeProfiles.filter(p=>p.name.toLowerCase()!=='jessie').every(p=>during.some(q=>q.name===p.name&&q.profile===p.profile));
        const js=getJessie(during);
        restrictedStreak=js.length===1&&js[0].profile===3?restrictedStreak+1:0;
        if(restrictedStreak>=2){restrictedConfirmed=true;break;}
      }
      stage='restoring';
      await restore();
      stage='verifying_restored';
      let after=[],restored=false,freeStreak=0,restoreRetries=0;
      // Never accept an immediate cached Free Access result as successful restoration.
      // Continue checking for delayed application of the earlier Indoor Only command.
      for(let attempt=0;attempt<10;attempt++){
        await sleep(4000);
        try{
          after=profiles(await dashboard());
          const js=getJessie(after);
          if(js.length!==1)throw Error('Jessie missing from verification');
          if(js[0].profile===3&&(attempt===3||attempt===6)){
            stage='retrying_restore';restoreRetries++;await restore();stage='verifying_restored';freeStreak=0;continue;
          }
          freeStreak=js[0].profile===2?freeStreak+1:0;
          if(freeStreak>=2&&attempt>=5){restored=true;break;}
        }catch(err){if(attempt===9)throw err;freeStreak=0;}
      }
      if(restored)restore=null;
      return reply(200,{status:restrictedConfirmed&&unchanged&&restored?'passed':'needs_review',restrictedConfirmed,otherCatsUnchanged:unchanged,restored,restoreRetries,initial:beforeProfiles,during,after,message:restored?(restrictedConfirmed&&unchanged?'Full electronic test passed; Jessie returned to Free Access after delayed checks.':'Jessie returned to Free Access after delayed checks, but the restriction or other-cat checks were inconclusive.'):'Jessie restoration is NOT confirmed. Check Sure Petcare immediately.'});
    }catch(e){
      let restoreAccepted=false,restoredConfirmed=false,restoreError=null;
      if(restore){
        try{stage=stage==='restricting'?'restricting_then_restoring':stage;await restore();restoreAccepted=true;}
        catch(err){restoreError=String(err?.message||'Restore request failed').slice(0,120);}
        if(readDashboard&&readProfiles){
          for(let attempt=0;attempt<4;attempt++){
            try{
              if(attempt)await new Promise(resolve=>setTimeout(resolve,1200));
              const profiles=readProfiles(await readDashboard());
              if(profiles.some(p=>p.name.toLowerCase()==='jessie'&&p.profile===2)){restoredConfirmed=true;break;}
            }catch{}
          }
        }
      }
      const cause=String(e?.message||'Unknown error').slice(0,140);
      const message=restoredConfirmed?'Jessie is confirmed back on Free Access. Test failed at '+stage+'.':restoreAccepted?'Restore command accepted, but confirmation is pending. Check Jessie’s access.':writeAttempted?'Restore is not confirmed. Check Jessie’s permission in Sure Petcare immediately.':'No change command was sent. Test stopped before changing Jessie.';
      return reply(200,{status:'error',stage,cause,writeAttempted,writeHttpStatus,restoreAccepted,restoredConfirmed,restoreError,message});
    }finally{globalThis.petPermissionTestBusy=false;}
  }
  if(url.pathname==='/sure/locations'&&(req.method==='GET'||req.method==='POST')){
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(body));};
    let body=null;
    if(req.method==='POST'){
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'JSON required'});
      let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>512)return reply(413,{error:'Request too large'});}body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
      if(!['inside','outside'].includes(body?.location)||!/^\\d+$/.test(String(body?.petId||'')))return reply(400,{error:'Invalid pet or location'});
    }
    let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
    if(!email||!password)return reply(503,{error:'Sure Petcare credentials not configured'});
    try{
      const headers={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':randomUUID()};
      const login=await fetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:headers['X-Device-Id']}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)throw Error('Sure Petcare login failed');
      const auth=await login.json(),access=auth.data?.token||auth.token||auth.access_token||auth.data?.access_token;
      if(!access)throw Error('Authentication token missing');
      headers.Authorization='Bearer '+access;
      const dashboard=await fetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});
      if(!dashboard.ok)throw Error('Unable to identify pets');
      const cats=(await dashboard.json()).data?.pets||[];
      if(!Array.isArray(cats))throw Error('Invalid pet list');
      if(body){
        const matches=cats.filter(p=>String(p.id)===String(body.petId));
        if(matches.length!==1) return reply(404,{error:'Pet not found in Sure Petcare'});
        const where=body.location==='inside'?1:2;
        const result=await fetch('https://app.api.surehub.io/api/pet/'+encodeURIComponent(body.petId)+'/position',{method:'POST',headers,body:JSON.stringify({where,since:new Date().toISOString()}),signal:AbortSignal.timeout(12000)});
        if(!result.ok)return reply(502,{error:'Sure Petcare rejected the location change (HTTP '+result.status+')'});
        return reply(200,{status:'accepted',petId:String(body.petId),location:body.location,message:'Sure Petcare accepted the change; waiting for a fresh read.'});
      }
      const results=await Promise.all(cats.map(async p=>{
        try{
          const response=await fetch('https://app.api.surehub.io/api/pet/'+encodeURIComponent(p.id)+'/position',{headers,signal:AbortSignal.timeout(9000)});
          if(!response.ok)throw Error('Location unavailable');
          const data=(await response.json()).data||{};
          return {petId:String(p.id),name:String(p.name||''),location:Number(data.where)===1?'inside':Number(data.where)===2?'outside':'unknown',since:data.since||null};
        }catch{return {petId:String(p.id),name:String(p.name||''),location:'unknown',since:null};}
      }));
      return reply(200,{status:'connected',pets:results,updated:new Date().toISOString()});
    }catch(e){return reply(502,{error:String(e.message||'Sure Petcare unavailable').slice(0,140)});}
  }
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(url.pathname==='/live/flap'){
    if(!token){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({status:'unavailable'}));}
    try{
      const response=await fetch('http://supervisor/core/api/states/lock.my_flap_locked_out',{
        headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw Error('HA state request failed');
      const data=await response.json();
      const state=String(data.state||'unknown');
      const status=state==='locked'?'indoor_only':state==='unlocked'?'normal':'unknown';
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({entity_id:'lock.my_flap_locked_out',state,status,updated:data.last_updated||null}));
    }catch{
      res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({status:'unavailable'}));
    }
  }
  // Read-only discovery of per-cat tag profiles. Never changes any flap or tag.
  if(url.pathname==='/sure/pet-permissions'){
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(body));};
    let options={};try{options=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
    const email=String(options.sure_email||'').trim(),password=String(options.sure_password||'');
    if(!email||!password)return reply(200,{status:'not_configured',message:'Sure Petcare credentials are not configured.'});
    try{
      const deviceId=randomUUID();
      const headers={'Content-Type':'application/json','Accept':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
      const login=await fetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:email,password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
      if(!login.ok)return reply(200,{status:'login_failed',message:'Sure Petcare authentication failed (HTTP '+login.status+').'});
      const auth=await login.json();
      const access=auth.data?.token||auth.token||auth.access_token||auth.data?.access_token;
      if(typeof access!=='string'||!access)return reply(200,{status:'unknown_login_format',message:'Unable to read Sure Petcare authentication response.'});
      const response=await fetch('https://app.api.surehub.io/api/me/start',{headers:{...headers,Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
      if(!response.ok)return reply(200,{status:'dashboard_failed',message:'Sure Petcare dashboard returned HTTP '+response.status+'.'});
      const data=(await response.json()).data||{};
      const devices=Array.isArray(data.devices)?data.devices:[];
      const animals=Array.isArray(data.pets)?data.pets:[];
      const flaps=devices.filter(d=>[3,6,13].includes(Number(d.product_id)));
      const cats=animals.map(p=>{
        const matches=flaps.flatMap(d=>(Array.isArray(d.tags)?d.tags:[]).filter(t=>String(t.id)===String(p.tag_id)).map(t=>({device:d,tag:t})));
        const match=matches.length===1?matches[0]:null;
        const profile=match?Number(match.tag.profile):null;
        return {surePetId:String(p.id??''),sureTagId:String(p.tag_id??''),name:String(p.name||'Unnamed cat').slice(0,60),matched:!!match,ambiguous:matches.length>1,profile:profile===2?'free_access':profile===3?'indoor_only':profile===0?'keep_current':'unknown',entry_safe_profile_known:profile===2||profile===3};
      });
      return reply(200,{status:'read_only',cats,flap_count:flaps.length,message:'Read-only discovery complete. No flap or pet permissions changed. Physical behaviour and write permissions are not yet verified.'});
    }catch{return reply(200,{status:'connection_error',message:'Unable to retrieve individual cat permissions from Sure Petcare.'});}
  }
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
  if(url.pathname==='/sure/archive'){
    let events=[];try{events=JSON.parse(fs.readFileSync('/data/sure-activity-cache.json','utf8'));if(!Array.isArray(events))events=[];}catch{}
    const date=url.searchParams.get('date');
    if(date&&/^\\d{4}-\\d{2}-\\d{2}$/.test(date))events=events.filter(e=>(()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(e.at)).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;})()===date);
    if(url.searchParams.get('format')==='csv'){
      const q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
      const lines=['Time (UTC),Pet,Movement'];
      for(const e of events)for(const pet of e.pets||[])lines.push([e.at,pet,e.type===0&&Number(e.details?.direction)===1?'In':e.type===0&&Number(e.details?.direction)===2?'Out':'Other'].map(q).join(','));
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="pet-control-history.csv"'});return res.end(lines.join('\\r\\n'));
    }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',...(url.searchParams.get('download')==='1'?{'Content-Disposition':'attachment; filename="pet-control-history.json"'}:{})});
    return res.end(JSON.stringify({events,total:events.length}));
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
      // Fast live path: fetch only the newest page. Archive retrieval is separate.
      const response=await fetch('https://app.api.surehub.io/api/timeline/household/'+encodeURIComponent(houseId)+'?page=0',{headers,signal:AbortSignal.timeout(12000)});
      if(!response.ok)return send('timeline_error',{events:[],total:0});
      const body=await response.json();
      const items=Array.isArray(body)?body:Array.isArray(body.data)?body.data:Array.isArray(body.data?.entries)?body.data.entries:null;
      if(!items)return send('timeline_error',{events:[],total:0});
      const historyComplete=false,historyError=false,pagesFetched=1,stopReason='live_only',paginationMethod='page_2',paginationTests=[];
      const firstPageOldest=items.at(-1)?.created_at||null,lastPageOldest=firstPageOldest;
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
        const detail={events:merged.filter(e=>Date.parse(e.at)>Date.now()-2*86400000).slice(0,250),total:merged.length,historyComplete,historyError,pagesFetched,stopReason,paginationMethod,paginationTests,firstPageOldest,lastPageOldest,oldestEvent:merged.at(-1)?.at||null,source:'Sure Petcare timeline; six-month backfill with long-term local retention'};
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
// Historical backfill is independent of live polling, capped to three pages per cycle.
let archiveBusy=false;
async function archiveBackfill(){
 if(archiveBusy)return;archiveBusy=true;
 try{
  let opts={};try{opts=JSON.parse(fs.readFileSync('/data/options.json','utf8'));}catch{}
  if(!opts.sure_email||!opts.sure_password)return;
  const file='/data/sure-activity-cache.json',progress='/data/sure-archive-progress.json';
  let page=2;try{const p=JSON.parse(fs.readFileSync(progress,'utf8'));if(p.complete)return;page=Math.max(2,Number(p.nextPage)||2);}catch{}
  const deviceId=randomUUID(),headers={'Accept':'application/json','Content-Type':'application/json','Origin':'https://surepetcare.io','Referer':'https://surepetcare.io','X-Requested-With':'com.sureflap.surepetcare','X-Device-Id':deviceId};
  const login=await fetch('https://app.api.surehub.io/api/auth/login',{method:'POST',headers,body:JSON.stringify({email_address:opts.sure_email,password:opts.sure_password,device_id:deviceId}),signal:AbortSignal.timeout(12000)});
  if(!login.ok)return;const auth=await login.json(),access=auth.data?.token||auth.token;if(!access)return;headers.Authorization='Bearer '+access;
  const start=await fetch('https://app.api.surehub.io/api/me/start',{headers,signal:AbortSignal.timeout(12000)});if(!start.ok)return;
  const home=await start.json(),hs=home.data?.households||home.data?.household||home.households||[],house=Array.isArray(hs)?hs[0]:hs;
  const houseId=house?.id||home.data?.household_id||home.data?.household?.id;if(!houseId)return;
  const lookup=new Map();for(const p of Array.isArray(home.data?.pets)?home.data.pets:[])if(p.id&&p.name)lookup.set(String(p.id),String(p.name).toLowerCase());
  let saved=[];try{saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(saved))saved=[];}catch{}
  const map=new Map(saved.filter(e=>e.id).map(e=>[String(e.id),e]));
  let complete=false;
  for(let i=0;i<3;i++){
   const response=await fetch('https://app.api.surehub.io/api/timeline/household/'+encodeURIComponent(houseId)+'?page='+page,{headers,signal:AbortSignal.timeout(12000)});
   if(!response.ok)break;const body=await response.json(),batch=Array.isArray(body)?body:Array.isArray(body.data)?body.data:Array.isArray(body.data?.entries)?body.data.entries:null;
   if(!batch)break;if(!batch.length){complete=true;break;}
   let oldest=Infinity,newCount=0;
   for(const e of batch){
    const id=String(e.id??''),at=e.created_at;if(!id||!Number.isFinite(Date.parse(at)))continue;
    oldest=Math.min(oldest,Date.parse(at));
    if(map.has(id))continue;
    const ids=[...(Array.isArray(e.pets)?e.pets:[]),...(Array.isArray(e.movements)?e.movements:e.movements?[e.movements]:[])];
    const names=[...new Set(ids.map(p=>String(p.name||lookup.get(String(p.pet_id??p.petId??p.id))||'').toLowerCase()).filter(n=>pets.includes(n)))];
    const m=Array.isArray(e.movements)?e.movements[0]:e.movements;
    const source=[m,e.movement,e.data?.movement,e.data,e].find(x=>x&&typeof x==='object'&&(x.direction!==undefined||x.side!==undefined||x.where!==undefined))||{};
    const details={};for(const k of ['where','direction','position','side','type','movement_type'])if(['string','number','boolean'].includes(typeof source[k]))details[k]=source[k];
    map.set(id,{id,type:Number(e.type),at,pets:names,details});newCount++;
   }
   if(!newCount){complete=true;break;}
   page++;
   if(oldest<Date.now()-183*86400000){complete=true;break;}
  }
  const merged=[...map.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  fs.writeFileSync(file,JSON.stringify(merged),{mode:0o600});
  fs.writeFileSync(progress,JSON.stringify({nextPage:page,complete,updated:new Date().toISOString()}),{mode:0o600});
 }catch{}finally{archiveBusy=false;}
}
setTimeout(archiveBackfill,60000);
setInterval(archiveBackfill,300000);
server.listen(80,'0.0.0.0');
