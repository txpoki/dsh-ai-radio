import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, sanitizeSettings, DEFAULTS } from '../lib/store.js';
import { freshNews } from '../lib/context.js';
import { rankCandidates, Planner, generateText } from '../lib/planner.js';
import { Music } from '../lib/music.js';
import { Speech } from '../lib/tts.js';
import { validatePublicUrl, publicFetch, isPrivateAddress } from '../lib/network.js';
import { equalPower } from '../client/engine.js';

const dirs=[];
const newStore=()=>{const dir=mkdtempSync(join(tmpdir(),'dsh-radio-test-'));dirs.push(dir);return new Store(dir);};
test.after(()=>{for(const dir of dirs)rmSync(dir,{recursive:true,force:true});});
const library=Array.from({length:16},(_,i)=>({id:String(i+1),title:`歌曲 ${i+1}`,artists:[`歌手 ${i%5}`],interval:180,album:'歌单专辑'}));
const now=Date.parse('2026-11-09T12:00:00+08:00');
const context={assemble:async()=>({now,localTime:'2026年11月9日 12:00',weather:{city:'上海',description:'多云',temperature:20,low:16,high:23},news:[],newsFailures:[]})};

test('settings normalize limits and preserve keys on empty updates',()=>{
  let config=sanitizeSettings({crossfadeSeconds:99,newsMinutes:-1,selectedPlaylistIds:['1','1','x'],llm:{apiKey:'secret'}});
  config=sanitizeSettings({llm:{apiKey:''}},config);
  assert.equal(config.crossfadeSeconds,12);assert.equal(config.newsMinutes,5);assert.deepEqual(config.selectedPlaylistIds,['1']);assert.equal(config.llm.apiKey,'secret');
  assert.equal(sanitizeSettings({clearLlmKey:true},config).llm.apiKey,'');
  assert.throws(()=>sanitizeSettings({timezone:'not/a/timezone'}));
});
test('server-side settings persist without exposing secrets',()=>{
  const store=newStore();store.settings({llm:{apiKey:'PRIVATE_LLM'},tts:{apiKey:'PRIVATE_TTS'}});store.state.cookie='MUSIC_U=private';store.save();
  const publicData=JSON.stringify(store.publicSettings());assert.ok(!publicData.includes('PRIVATE'));assert.ok(store.publicSettings().llm.hasKey);
  assert.equal(new Store(store.directory).state.settings.llm.apiKey,'PRIVATE_LLM');
  assert.equal(new Store(store.directory).state.cookie,'MUSIC_U=private');
  assert.ok(readFileSync(join(store.directory,'state.json'),'utf8').includes('PRIVATE_LLM'));
});
test('playback events are idempotent and unknown songs are ignored',()=>{
  const store=newStore();store.state.library=library;const event={eventId:'same',songId:'1',action:'played',fraction:1};store.event(event);store.event(event);store.event({...event,eventId:'unknown',songId:'missing'});assert.equal(store.state.history.length,1);
});
test('news freshness uses the user timezone, rejects future and stale dates',()=>{
  const make=(id,date,title=id)=>({id,title,publishedAt:Date.parse(date)});
  const result=freshNews([make('today','2026-11-08T16:05:00Z'),make('yesterday','2026-11-08T15:59:00Z'),make('future','2026-11-10T00:00:00Z'),make('used','2026-11-09T00:00:00Z')],now,'Asia/Shanghai',['used']);
  assert.deepEqual(result.map(x=>x.id),['today']);
});
test('news deduplicates the same title across sources',()=>{
  const items=['a','b'].map(id=>({id,title:'国际空间站今天迎来新乘组',publishedAt:now-60000}));assert.equal(freshNews(items,now,'Asia/Shanghai').length,1);
});
test('selection avoids recently heard and temporarily unavailable songs',()=>{
  const history=[{songId:'1',artists:['歌手 0'],action:'played',at:now}];
  const ranked=rankCandidates(library,history,[],{now,random:()=>.5,blocked:new Set(['2'])});assert.notEqual(ranked[0].id,'1');assert.ok(!ranked.some(x=>x.id==='2'));
});
test('equal-power crossfade preserves power and reaches correct endpoints',()=>{
  const {incoming,outgoing}=equalPower();assert.equal(incoming[0],0);assert.equal(outgoing.at(-1)<1e-6,true);assert.equal(incoming.at(-1),1);
  for(let i=0;i<incoming.length;i++)assert.ok(Math.abs(incoming[i]**2+outgoing[i]**2-1)<1e-6);
});
test('planner constrains AI song IDs to the actual library and deduplicates',async()=>{
  const store=newStore();store.state.library=library;
  const planner=new Planner(store,context,{now:()=>now,random:()=>.3,generate:async()=>JSON.stringify({songs:[{id:'fake',intro:'bad'},{id:'2',intro:'好歌'},{id:'2',intro:'重复'}]})});
  const batch=await planner.batch({requestId:'1',opening:true});assert.equal(batch.segments.length,4);assert.ok(batch.segments.every(x=>library.some(s=>s.id===x.track.id)));assert.equal(new Set(batch.segments.map(x=>x.track.id)).size,4);
});
test('AI outage falls back to deterministic hosting without stopping music',async()=>{
  const store=newStore();store.state.library=library;const planner=new Planner(store,context,{now:()=>now,generate:async()=>{throw new Error('AI unavailable');}});
  const batch=await planner.batch({requestId:'fallback',opening:true});assert.equal(batch.mode,'continuity');assert.equal(batch.segments.length,4);assert.match(batch.segments[0].speech.text,/上海/);assert.match(batch.notice,/unavailable/);
});
test('duplicate plan request does not generate and consume a second batch',async()=>{
  const store=newStore();store.state.library=library;let count=0;const planner=new Planner(store,context,{generate:async()=>{count++;return'{}';}});
  const [a,b]=await Promise.all([planner.batch({requestId:'same'}),planner.batch({requestId:'same'})]);assert.equal(a.id,b.id);assert.equal(count,1);
});
test('news is marked used only after the speech was actually heard',async()=>{
  const store=newStore();store.state.library=library;const news={id:'news-1',title:'有来源的当日消息',source:'测试来源',publishedAt:now-1000,summary:'已核实的内容。'};
  const planner=new Planner(store,{assemble:async()=>({...await context.assemble(),news:[news]})},{now:()=>now,generate:async()=>'{}'});
  const batch=await planner.batch({requestId:'news'});assert.equal(store.state.lastNewsAt,undefined);assert.match(batch.segments[0].speech.text,/测试来源/);
  planner.heard(batch.segments[0].speech);planner.heard(batch.segments[0].speech);assert.equal(store.state.lastNewsAt,now);assert.equal(store.state.spoken.length,1);
  const next=await planner.batch({requestId:'no-repeat'});assert.ok(next.segments.every(x=>!x.speech?.news));
});
test('small libraries can loop without an unbounded selection history',async()=>{
  const store=newStore();store.state.library=library.slice(0,2);const planner=new Planner(store,context,{generate:async()=>'{}'});
  for(let i=0;i<20;i++)assert.equal((await planner.batch({requestId:String(i)})).segments.length,2);assert.equal(planner.lastSelected.length,0);
});
test('DSH generation uses the real streaming contract and rejects terminal errors',async()=>{
  let received;const llm={async*stream(options){received=options;yield{type:'text-delta',text:'hello'};yield{type:'finish',reason:{kind:'stop'}};}};
  assert.equal(await generateText({mode:'dsh',provider:'p',model:'m'},llm,'system',{time:'now'}),'hello');assert.equal(received.messages[0].content[0].type,'text');
  await assert.rejects(()=>generateText({mode:'dsh',provider:'p',model:'m'},{async*stream(){yield{type:'finish',reason:{kind:'error'}};}},'s',{}));
});
test('account switches clear the previous library, listening history and credentials in public responses',async()=>{
  const store=newStore();Object.assign(store.state,{libraryOwner:'old',library,history:[{songId:'1'}],remoteHistory:[{}],cookie:'old'});
  const music=new Music(store,{getAccount:async()=>({userId:'new',nickname:'New'}),getMyPlaylists:async()=>[]});music.syncRemoteHistory=async()=>[];
  await music.login('MUSIC_U=new');assert.equal(store.state.library.length,0);assert.equal(store.state.history.length,0);assert.equal(store.state.cookie,'MUSIC_U=new');
});
test('playlist import keeps useful results from a partial upstream failure',async()=>{
  const store=newStore();store.state.cookie='MUSIC_U=x';const music=new Music(store,{getPlaylistSongs:async(id)=>{if(id==='2')throw new Error('Unavailable playlist');return{name:'one',songs:library.slice(0,2)};}});
  const result=await music.loadLibrary(['1','2']);assert.equal(result.count,2);assert.equal(result.failures.length,1);
});
test('stream resolution rejects trial clips even if a URL is returned',async()=>{
  const store=newStore();store.state.library=library;
  const music=new Music(store,{},async()=>new Response(JSON.stringify({code:200,data:[{url:'https://m1.music.126.net/trial.mp3',freeTrialInfo:{start:0,end:45}}]}),{headers:{'Content-Type':'application/json'}}));
  await assert.rejects(()=>music.stream('1'),/试听/);
});
test('TTS cache keys include the selected voice',async()=>{
  const store=newStore();store.settings({tts:{provider:'openai',apiKey:'test',voice:'nova'}});let calls=0;
  const speech=new Speech(store,{fetchImpl:async()=>{calls++;return new Response(Buffer.from('MP3'),{headers:{'Content-Type':'audio/mpeg'}});}});
  const a=await speech.prepare('hello'),b=await speech.prepare('hello');assert.equal(a.url,b.url);assert.equal(calls,1);
  store.settings({tts:{voice:'shimmer'}});const c=await speech.prepare('hello');assert.notEqual(a.url,c.url);assert.equal(calls,2);
});
test('public URL validation rejects private hosts and redirect hops',async()=>{
  for(const addr of ['127.0.0.1','10.0.0.1','172.16.2.1','192.168.2.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.ok(isPrivateAddress(addr));
  await assert.rejects(()=>validatePublicUrl('http://localhost/a'));
  await assert.rejects(()=>validatePublicUrl('https://example.com',{resolve:async()=>[{address:'127.0.0.1'}]}));
  await assert.rejects(()=>publicFetch('https://example.com',{}, {resolve:async()=>[{address:'1.1.1.1'}],fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/secrets'}})}));
});
test('media proxy rejects unrecognized CDN domains',async()=>{await assert.rejects(()=>validatePublicUrl('https://example.com/song.mp3',{domains:['music.126.net']}),/音频域名/);});
