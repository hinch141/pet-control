'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
test('Android manifest provides same-origin standalone launch and icon',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(root,'web/manifest.webmanifest'),'utf8'));
 assert.equal(m.display,'standalone');assert.equal(m.start_url,'./');assert.equal(m.scope,'./');
 assert.ok(m.icons.some(x=>x.src==='./icon.svg'&&x.type==='image/svg+xml'));
 assert.ok(fs.existsSync(path.join(root,'web/icon.svg')));
});
test('service worker does not cache protected household pages or responses',()=>{
 const sw=fs.readFileSync(path.join(root,'web/sw.js'),'utf8');
 assert.doesNotMatch(sw,/caches\.open\s*\(/);
 assert.doesNotMatch(sw,/cache\.put\s*\(/);
 assert.doesNotMatch(sw,/cache\.addAll\s*\(/);
});
test('app server explicitly permits icon resource',()=>{
 const s=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(s,/'icon\.svg'\]\.includes\(filename\)/);
 assert.match(s,/\.svg':\s*'image\/svg\+xml'/);
});
