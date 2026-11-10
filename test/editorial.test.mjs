import test from 'node:test';
import assert from 'node:assert/strict';
import { linkPlan, composeLink } from '../lib/editorial.js';
import { generateText } from '../lib/planner.js';
const song={id:'1',title:'测试歌曲',artists:['测试歌手']};
test('the episode retains short links and bounds factual stories even if the director requests only stories',()=>{
  const songs=Array.from({length:32},(_,i)=>({...song,id:String(i)}));
  const facts=new Map(songs.map(x=>[x.id,{sources:[{id:'verified'}]}]));
  const plan=linkPlan(songs,songs.map(x=>({songId:x.id,mode:'story'})),facts);
  assert.equal(plan[0].mode,'first');assert.ok(plan.filter(x=>x.mode==='brief').length>=Math.floor(songs.length/3));
  assert.ok(plan.filter(x=>x.mode==='story').length<=Math.ceil(songs.length/3));
  assert.ok(plan.every((x,i)=>!i||x.mode!=='story'||plan[i-1].mode!=='story'));
  assert.ok(linkPlan(songs,[],facts).some(x=>x.mode==='callback'));
});
test('casual conversation survives missing music research while unverified artist facts are removed',()=>{
  const line={hostTalk:'有时候只是想看几点，回过神来，倒先回了三条消息。',songFact:'歌手十岁时为了养家创作了此曲。',sourceIds:['invented']};
  const result=composeLink(song,1,line,[],{mode:'life'});
  assert.match(result.intro,/三条消息/);assert.ok(!result.intro.includes('养家'));assert.match(result.intro,/测试歌手/);assert.deepEqual(result.sourceIds,[]);
});
test('a story includes only facts with matching references and a brief link cannot expand into a lecture',()=>{
  const line={hostTalk:'这回有个小细节。',songFact:'主唱在访谈里说，开头保留了原始试录。',sourceIds:['verified','invented']};
  const story=composeLink(song,3,line,[{id:'verified'}],{mode:'story'});
  assert.match(story.intro,/原始试录/);assert.deepEqual(story.sourceIds,['verified']);
  const brief=composeLink(song,2,line,[{id:'verified'}],{mode:'brief'});
  assert.ok(!brief.intro.includes('小细节')&&!brief.intro.includes('原始试录'));assert.deepEqual(brief.sourceIds,[]);
});
test('missing sources change a planned story into conversation and unknown old-format anecdotes remain blocked',()=>{
  const songs=Array.from({length:9},(_,i)=>({...song,id:String(i)}));
  assert.ok(linkPlan(songs,songs.map(x=>({songId:x.id,mode:'story'}))).every(x=>x.mode!=='story'));
  const result=composeLink(song,0,{intro:'这首歌创作于一个不存在的年代。',sourceIds:[]},[],{mode:'first'});
  assert.ok(!result.intro.includes('不存在'));assert.match(result.intro,/测试歌曲/);
});
test('a model cannot hide catalogue facts in the chat field and sentence endings are retained',()=>{
  const result=composeLink(song,0,{hostTalk:'小鲸先把开场白缩短一点。测试歌手给电影做了配乐。黑胶和CD都有。',songFact:'',sourceIds:[]},[],{mode:'first'});
  assert.match(result.intro,/开场白缩短一点。/);assert.ok(!result.intro.includes('电影')&&!result.intro.includes('黑胶'));
});
test('preview reasoning falls back only to an effort advertised by the bound model',async()=>{
  let effort;
  const llm={stream(){throw new Error('must use prepared stream');},async prepareCall(config,signal,choose){const controls=choose({}, {reasoning:{efforts:[{id:'low'}]}});effort=controls.reasoningEffort;return{config:{...config,...controls},async*stream(){yield{type:'text-delta',text:'{}'};yield{type:'finish',reason:{kind:'stop'}};}};}};
  await generateText({mode:'dsh',provider:'p',model:'m'},llm,'system',{},undefined,{reasoningEffort:'off',reasoningFallbacks:['minimal','low']});assert.equal(effort,'low');
});
