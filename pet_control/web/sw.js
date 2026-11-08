const CACHE='pet-control-v2-18-86';
const APP_FILES=['./','./index.html','./manifest.webmanifest','./live.js'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_FILES)));
});
self.addEventListener('message',event=>{
 if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pet-control-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const url=new URL(request.url);
 if(!['/','/index.html','/manifest.webmanifest','/live.js'].some(suffix=>url.pathname.endsWith(suffix)))return;
 event.respondWith(fetch(request).catch(()=>caches.match(request)));
});
