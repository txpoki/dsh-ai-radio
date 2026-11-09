import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../lib/store.js';
import { Speech, DAFEIYU_VOICE } from '../lib/tts.js';
import { wav } from '../scripts/demo.mjs';
const dirs=[];
function fixture(tts={}) { const directory=mkdtempSync(join(tmpdir(),'radio-voice-'));dirs.push(directory);const store=new Store(directory);store.settings({tts:{provider:'fish',apiKey:'',...tts}});return store; }
test.after(()=>{for(const directory of dirs)rmSync(directory,{recursive:true,force:true});});
test('missing Fish credentials raise a configuration error without using Edge or making an API call',async()=>{
  const previous=process.env.AI_RADIO_TTS_KEY;delete process.env.AI_RADIO_TTS_KEY;
  try {
    let calls=0;const speech=new Speech(fixture(),{fetchImpl:async()=>{calls++;throw new Error('not expected');},edgeImpl:async()=>{calls++;throw new Error('not expected');}});
    await assert.rejects(()=>speech.prepare('你好'),error=>error.code==='TTS_KEY_MISSING'&&error.permanent&&/Fish/.test(error.message));assert.equal(calls,0);
  }finally{if(previous===undefined)delete process.env.AI_RADIO_TTS_KEY;else process.env.AI_RADIO_TTS_KEY=previous;}
});
test('an old Edge substitute cached under Fish settings is rejected and replaced by real Fish output',async()=>{
  const store=fixture({apiKey:'test'});let calls=0;
  const speech=new Speech(store,{fetchImpl:async()=>{calls++;return new Response(wav(2),{headers:{'Content-Type':'audio/wav'}});}});
  const text='修正缓存音色';const hash=createHash('sha256').update(JSON.stringify({text,...store.state.settings.tts})).digest('hex');
  writeFileSync(join(speech.directory,hash+'.audio'),wav(1));writeFileSync(join(speech.directory,hash+'.json'),JSON.stringify({provider:'edge',duration:1,type:'audio/wav',notice:'old substitute'}));
  const audio=await speech.prepare(text);assert.equal(calls,1);assert.equal(audio.provider,'fish');assert.equal(audio.voice,DAFEIYU_VOICE.id);assert.equal(audio.duration,2);assert.equal(audio.notice,'');
  const restored=new Speech(store,{fetchImpl:async()=>{throw new Error('cache must be reused');}});assert.equal((await restored.prepare(text)).provider,'fish');
});
test('Fish authorization and quota errors remain explicit and cannot call a substitute service',async()=>{
  for(const status of [401,402,404]) {
    let edgeCalls=0;const speech=new Speech(fixture({apiKey:'test'}),{fetchImpl:async()=>new Response('{}',{status}),edgeImpl:async()=>{edgeCalls++;throw new Error('not expected');}});
    await assert.rejects(()=>speech.prepare('你好'),error=>error.code==='TTS_HTTP_'+status&&error.permanent&&error.message.includes(String(status)));assert.equal(edgeCalls,0);
  }
});
test('a permanent voice configuration failure does not delay every clip and leaves a music-only programme warning',async()=>{
  const previous=process.env.AI_RADIO_TTS_KEY;delete process.env.AI_RADIO_TTS_KEY;
  try{
    const speech=new Speech(fixture());const p={opening:{text:'开场'},segments:[{speech:{text:'第一首'}},{speech:{text:'第二首'}}]};
    await speech.prepareProgramme(p,{signal:new AbortController().signal,progress(){}});
    assert.equal(p.audioTiming.failed,3);assert.equal(p.audioTiming.measured,0);assert.match(p.audioTiming.warning,/API Key/);assert.equal(speech.audio.size,0);
  }finally{if(previous===undefined)delete process.env.AI_RADIO_TTS_KEY;else process.env.AI_RADIO_TTS_KEY=previous;}
});
