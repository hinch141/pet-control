// Network-only service worker: do not cache authenticated household data or app pages.
// No versioned cache: the app checks the running add-on release and refreshes when needed.
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pet-control-')).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();});
