import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadioService } from '../lib/service.js';
import { apply } from '../lib/index.js';
import { attachDemo } from '../scripts/demo.mjs';

async function fixture(fn){const directory=mkdtempSync(join(tmpdir(),'radio-api-'));const service=attachDemo(new RadioService({directory,demo:true}),{seconds:1});const server=createServer(service.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/dsh-ai-radio`;try{await fn({service,base});}finally{service.dispose();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}}
const post=(base,path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('bootstrap only returns public state and a usable plugin manifest',async()=>fixture(async({base,service})=>{
  service.store.state.cookie='MUSIC_U=SECRET_COOKIE';service.store.settings({llm:{apiKey:'SECRET_LLM'},tts:{apiKey:'SECRET_TTS'}});
  const data=await(await fetch(base+'/bootstrap')).json();assert.equal(data.demo,true);assert.equal(data.libraryCount,12);assert.ok(data.settings.llm.hasKey);assert.ok(!JSON.stringify(data).includes('SECRET_'));
}));
test('cross-origin mutations and non-JSON forms are rejected',async()=>fixture(async({base})=>{
  assert.equal((await post(base,'/settings',{city:'南京'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(base+'/settings',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
}));
test('editorial preview returns three samples without starting or replacing an episode',async()=>fixture(async({base,service})=>{
  const result=await(await post(base,'/programme/preview',{persona:'自然聊天'})).json();
  assert.equal(result.samples.length,3);assert.ok(result.opening);assert.equal(service.planner.current,null);assert.equal(service.planner.cursor,0);assert.equal(service.store.state.spoken.length,0);
}));
test('daily recommendation metadata is read-only and can be explicitly loaded as the radio library',async()=>fixture(async({base,service})=>{
  const before=service.store.state.library.length;
  const daily=await(await fetch(base+'/recommendations/daily')).json();
  assert.equal(daily.count,4);assert.equal(service.store.state.library.length,before);assert.equal(daily.songs,undefined);assert.equal(daily.ownerId,undefined);
  const selected=[...service.store.state.settings.selectedPlaylistIds];
  const result=await(await post(base,'/library',{source:'daily'})).json();
  assert.equal(result.count,4);assert.equal(service.store.state.librarySource.type,'daily');assert.deepEqual(service.store.state.settings.selectedPlaylistIds,selected);
  const bootstrap=await(await fetch(base+'/bootstrap')).json();assert.equal(bootstrap.libraryCount,4);assert.equal(bootstrap.librarySource.type,'daily');
  const plan=await(await post(base,'/plan',{requestId:'daily-episode',opening:true})).json();assert.equal(plan.total,4);
}));
test('plan, speech prefetch and played acknowledgment form a complete radio pipeline',async()=>fixture(async({base,service})=>{
  const plan=await(await post(base,'/plan',{requestId:'end-to-end',opening:true})).json();assert.equal(plan.segments.length,4);
  const speech=plan.segments[0].speech;const prepared=await(await post(base,'/speech/prepare',{id:speech.id})).json();
  const response=await fetch(new URL(prepared.url,base));assert.equal(response.headers.get('content-type'),'audio/wav');assert.ok((await response.arrayBuffer()).byteLength>44);
  await post(base,'/speech/heard',{id:speech.id});assert.equal(service.store.state.spoken.length,1);
}));
test('audio Range requests and HEAD work for seeking and preloading',async()=>fixture(async({base})=>{
  const head=await fetch(base+'/track/1001/audio',{method:'HEAD'});assert.equal(head.status,200);assert.ok(Number(head.headers.get('content-length'))>100);
  const response=await fetch(base+'/track/1001/audio',{headers:{Range:'bytes=0-43'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,44);
}));
test('unknown speech IDs and arbitrary media paths cannot be fetched',async()=>fixture(async({base})=>{
  assert.equal((await post(base,'/speech/prepare',{id:'not-issued'})).status,400);assert.equal((await fetch(base+'/track/https:example/audio')).status,404);
}));
test('host lifecycle registers and disposes routes and tools cleanly',()=>{
  const directory=mkdtempSync(join(tmpdir(),'radio-plugin-'));const disposers=[];let route,tool,prompt;
  const ctx={webServer:{register:r=>{route=r;return()=>{route=null;};}},tools:{register:t=>{tool=t;return()=>{tool=null;};}},systemPrompt:{section:s=>{prompt=s;}},effect:fn=>{const d=fn();if(typeof d==='function')disposers.push(d);}};
  try{apply(ctx,{dataDir:directory});assert.equal(route.path,'/dsh-ai-radio');assert.equal(tool.name,'ai_radio');assert.ok(prompt.text);for(const d of disposers.reverse())d();assert.equal(route,null);assert.equal(tool,null);}finally{rmSync(directory,{recursive:true,force:true});}
});
