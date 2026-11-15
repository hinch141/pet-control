'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const config=fs.readFileSync(path.join(root,'config.yaml'),'utf8');
const sw=fs.readFileSync(path.join(root,'web/sw.js'),'utf8');
const block=html.match(/\/\* Standalone-app update UX; does not affect Home Assistant commands\. \*\/([\s\S]*?)<\/script>/);
test('version is injected from the installed add-on, not independently hard-coded',()=>{
 assert.ok(block,'update handler exists');
 assert.match(block[0],/__PET_HQ_LOADED_VERSION__/);
 assert.match(server,/replaceAll\('__PET_HQ_LOADED_VERSION__',version\)/);
 assert.match(config,/version: "2.18.172"/);
 assert.doesNotMatch(sw,/pet-control-v2-18-143/);
});
test('server disables caching of delivered HTML and JavaScript',()=>{
 assert.match(server,/filename==='index\.html'\|\|filename==='sw\.js'\|\|filename==='live\.js'\?'no-store, max-age=0'/);
});
function harness(installed,{editing=false,modal=false,online=true}={}){
 const listeners={};let reloads=0,requests=0;const storage=new Map();
 const doc={visibilityState:'visible',activeElement:{tagName:editing?'INPUT':'BODY',isContentEditable:false},
  getElementById(id){if(id==='modalWrap')return {};return null;},
  addEventListener(name,fn){(listeners['doc:'+name]??=[]).push(fn);}};
 const win={addEventListener(name,fn){(listeners['win:'+name]??=[]).push(fn);}};
 const context={document:doc,window:win,navigator:{onLine:online},getComputedStyle:()=>({display:modal?'flex':'none'}),
  fetch:async(url,opts)=>{requests++;assert.equal(url,'./pet-hq/release-info');assert.equal(opts.cache,'no-store');return {ok:true,json:async()=>({version:installed})};},
  location:{reload(){reloads++;}},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  console,setTimeout:()=>0};
 const script='/* Standalone-app update UX; does not affect Home Assistant commands. */'+block[1].replace('__PET_HQ_LOADED_VERSION__','2.18.170');
 vm.runInNewContext(script,context);
 const fire=async name=>{for(const fn of listeners[name]||[])await fn();};
 return {fire,requests:()=>requests,reloads:()=>reloads,storage};
}
test('current release does not reload',async()=>{
 const h=harness('2.18.170');await h.fire('win:pageshow');assert.equal(h.reloads(),0);
});
test('new release reloads once, never loops',async()=>{
 const h=harness('2.18.172');await h.fire('win:pageshow');await h.fire('win:pageshow');assert.equal(h.reloads(),1);
});
test('editing a field or modal defers reload',async()=>{
 for(const opts of [{editing:true},{modal:true}]){const h=harness('2.18.172',opts);await h.fire('win:pageshow');assert.equal(h.reloads(),0);}
});
test('offline app does not reload',async()=>{
 const h=harness('2.18.172',{online:false});await h.fire('win:pageshow');assert.equal(h.reloads(),0);assert.equal(h.requests(),0);
});

test('update confirmation is persistent and dismissible',()=>{
 assert.match(html,/sessionStorage\.setItem\(noticeKey,installed\)/);
 assert.match(html,/id='pet-hq-updated-notice'/);
 assert.match(html,/pet-hq-updated-dismiss/);
 assert.match(html,/sessionStorage\.removeItem\(noticeKey\)/);
 assert.doesNotMatch(html,/setTimeout\([^)]*bar\.remove/);
});

test('each device gets a persistent version notice independent of prior marker',()=>{
 assert.match(html,/localStorage\.getItem\(seenKey\)/);
 assert.match(html,/localStorage\.setItem\(seenKey,loadedVersion\)/);
 assert.match(html,/localStorage\.setItem\(dismissedKey,loadedVersion\)/);
 assert.match(html,/window\.addEventListener\('pageshow',showInstalledNotice\)/);
 assert.match(html,/pet-hq-updated-dismiss/);
});
