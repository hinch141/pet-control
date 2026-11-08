'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const config=fs.readFileSync(path.join(__dirname,'../config.yaml'),'utf8');

test('standalone listener uses the authenticated handler, not ingress handler',()=>{
 assert.match(source,/http\.createServer\(\(req,res\)=>handleRequest\(req,res,true\)\)/);
 assert.match(source,/if\(standaloneRequest\)\{[\s\S]*?await verifyStandalone\(req\.headers\['cf-access-jwt-assertion'\]\)/);
});
test('ingress listener is separate and checks Home Assistant proxy address',()=>{
 assert.match(source,/http\.createServer\(\(req,res\)=>handleRequest\(req,res,false\)\)/);
 assert.match(source,/else if\(peer!=='172\.30\.32\.2'\)/);
});
test('standalone port and credentials are configured explicitly',()=>{
 assert.match(config,/8080\/tcp: 18080/);
 for(const key of ['access_team_domain','access_audience','access_emails'])assert.match(config,new RegExp('^  '+key+': str\\?$', 'm'));
});
