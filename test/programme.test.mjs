import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { Programme } from '../lib/programme.js';
import { MusicResearch } from '../lib/research.js';
import { Speech, DAFEIYU_VOICE } from '../lib/tts.js';
import { generateText } from '../lib/planner.js';
import { stationBed } from '../lib/bed.js';
import { systemProxy } from '../lib/proxy.js';

const dirs = [];
const now = Date.parse('2026-11-09T10:00:00+08:00');
function fixture(size = 64, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'whale-programme-')); dirs.push(directory);
  const store = new Store(directory);
  store.state.library = Array.from({ length: size }, (_, i) => ({ id: String(i + 1), title: '歌曲' + (i + 1), artists: ['歌手' + i % 5], album: '专辑', interval: 300 }));
  const calls = [], searches = [];
  const context = { assemble: async () => ({ now, localTime: '2026年11月9日 上午10:00', weather: { city: '上海', description: '晴', temperature: 22 }, news: [{ id: 'today', source: '示例媒体', title: '可核对的当日消息', url: 'https://example.com/news', publishedAt: now - 1000 }], newsFailures: [] }) };
  const research = new MusicResearch(store, { now: () => now, search: async query => { searches.push(query); return [{ title: '官方歌曲介绍', url: 'https://example.com/story/' + encodeURIComponent(query), summary: '艺人介绍了这张专辑的收录曲目。' }]; } });
  const generate = async (_settings, _llm, prompt, payload, _fetch, options) => {
    calls.push({ prompt, payload, options });
    if (payload.stage === 'director') return JSON.stringify({ title: '今天的小鲸电台', editorialNotes: '从舒缓走向明亮，再用温柔的尾声收束。', arc: [{ title: '出发', purpose: '慢慢进入音乐' }, { title: '回家', purpose: '柔和收束' }], order: [...payload.songs.map(x => x.id)].reverse(), researchQueries: [{ songId: '1', query: '歌手1 官方访谈' }] });
    return JSON.stringify({ opening: '听众朋友们，大家好！我是小鲸。今天也来一起听喜欢的歌吧。', songs: payload.songs.map(x => ({ id: x.id, intro: '承接上一首的心情，接下来听' + x.artists.join('、') + '的《' + x.title + '》。', sourceIds: x.sources.slice(0, 1).map(y => y.id), newsText: x.newsSlot?.title || '', joke: x.humorSlot ? '小鲸把好心情也装进了歌单。' : '' })) });
  };
  const planner = new Programme(store, context, { research, now: () => now, generate, ...overrides }); planner.lastRenewAt = now;
  return { store, planner, calls, searches };
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

test('the entire playlist is researched and scripted before any batch is issued', async () => {
  const { planner, store, calls, searches } = fixture();
  planner.start(); await planner.preparing;
  assert.equal(planner.job.status, 'ready');
  assert.equal(planner.current.segments.length, 64);
  assert.equal(planner.current.research.length, 64); assert.equal(searches.length, 65);
  assert.equal(calls.filter(x => x.payload.stage === 'script').length, 8);
  assert.equal(calls[0].payload.songs.length, 64);
  assert.ok(calls.every(x => x.options.timeoutMs >= 180000 && x.options.maxTokens >= 4000));
  const selected = []; let first;
  for (let i = 0; i < 16; i++) {
    const batch = await planner.batch({ requestId: 'batch-' + i, opening: true });
    if (!i) first = batch; else assert.equal(batch.opening, null);
    selected.push(...batch.segments.map(x => x.track.id));
  }
  assert.deepEqual(selected, [...store.state.library.map(x => x.id)].reverse());
  assert.equal(calls.length, 9, 'playback consumes the prepared script without per-four-song AI generation');
  assert.match(first.opening.text, /小鲸/);
  assert.match(planner.article(), /编导说明/);
  assert.match(planner.article(), /64\. 歌曲1/);
  assert.ok(planner.current.segments.every((x,i) => x.cue.placement === (i ? 'overlap-tail-and-head' : 'before-track')));
  assert.ok(planner.current.segments.some(x => x.speech.sourceIds.length));
});
test('planning failure is explicit and never masquerades as a completed AI programme', async () => {
  const { planner } = fixture(5, { generate: async () => { throw new Error('model offline'); } });
  planner.start(); await planner.preparing;
  assert.equal(planner.job.status, 'failed'); assert.equal(planner.current, null); assert.match(planner.job.error, /offline/);
});
test('a three-song editorial preview preserves the full programme, playback cursor and draft',async()=>{
  const {planner,store,calls}=fixture(5);planner.start();await planner.preparing;
  planner.cursor=2;const originalId=planner.current.id;store.state.programmeDraft={keep:true};
  const beforeCalls=calls.length,beforeSpoken=store.state.spoken.length;
  const result=await planner.preview({persona:'说得轻快一点'});
  assert.equal(result.samples.length,3);assert.equal(planner.current.id,originalId);assert.equal(planner.cursor,2);assert.deepEqual(store.state.programmeDraft,{keep:true});
  assert.equal(store.state.spoken.length,beforeSpoken);assert.equal(calls.length,beforeCalls+1);assert.equal(calls.at(-1).payload.songs.length,3);
  assert.equal(result.samples[2].deliveryMode,'brief');
});
test('a truncated editorial preview retries with more output budget and keeps the episode untouched',async()=>{
  const {planner}=fixture(3);const original=planner.generate,budgets=[];
  planner.generate=async(...args)=>{budgets.push(args[5].maxTokens);if(budgets.length===1)throw Object.assign(new Error('limit'),{code:'OUTPUT_LIMIT'});return original(...args);};
  const preview=await planner.preview();assert.equal(preview.samples.length,3);assert.deepEqual(budgets,[8192,16384]);assert.equal(planner.current,null);
});
test('an existing script and a changed voice are recalibrated without repeating editorial generation', async () => {
  const { planner, store, calls } = fixture(3);
  planner.start(); await planner.preparing;
  const id = planner.current.id, callCount = calls.length;
  delete planner.current.audioSignature;
  let audioCalls = 0;
  planner.prepareAudio = async p => {
    audioCalls++;
    for (const speech of [p.opening, ...p.segments.map(x => x.speech)]) { speech.duration = 10; speech.timingMeasured = true; }
    p.audioTiming = { measured: 4, total: 4, failed: 0 };
  };
  planner.start(); await planner.preparing;
  assert.equal(planner.current.id, id); assert.equal(calls.length, callCount); assert.equal(audioCalls, 1);
  assert.equal(planner.current.timeline[1].speechEnd - planner.current.timeline[1].speechStart, 10);
  store.state.settings.tts.voice = 'zh-CN-XiaoxiaoNeural';
  planner.start(); await planner.preparing;
  assert.equal(audioCalls, 2); assert.equal(calls.length, callCount);
  planner.start(); assert.equal(planner.job.status, 'ready'); assert.equal(audioCalls, 2);
});
test('cancelling research cannot publish a partially completed programme', async () => {
  const { planner } = fixture(3);
  planner.research.searchImpl = (_q, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  planner.start(); const pending = planner.preparing; await new Promise(r => setTimeout(r, 5)); planner.cancel(); await pending;
  assert.equal(planner.job.status, 'cancelled'); assert.equal(planner.current, null);
});
test('unknown model IDs are rejected and missing songs are retained exactly once', async () => {
  const { planner, calls } = fixture(5);
  const original = planner.generate;
  planner.generate = async (...args) => args[3].stage === 'director' ? JSON.stringify({ title: 'x', order: ['unknown', '2', '2'], arc: [] }) : original(...args);
  planner.start(); await planner.preparing;
  const ids = planner.current.segments.map(x => x.track.id);
  assert.equal(ids[0], '2'); assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5); assert.ok(!ids.includes('unknown'));
  assert.ok(calls.at(-1).prompt.includes('鲸鱼少女'));
});
test('missing research cannot turn unsupported model stories into on-air facts', async () => {
  const { planner } = fixture(2);
  planner.research.searchImpl = async () => [];
  planner.start(); await planner.preparing;
  assert.equal(planner.current.missingResearch, 2);
  assert.ok(planner.current.segments.every(x => x.speech.sourceIds.length === 0 && x.speech.intro.includes(x.track.title) && !x.speech.intro.includes('创作于')));
});
test('news is removed from a reused script after the date changes', async () => {
  const { planner } = fixture(10);
  planner.start(); await planner.preparing;
  assert.ok(planner.current.segments.some(x => x.speech.news));
  planner.now = () => now + 86400000; planner.lastRenewAt = now + 86400000;
  const issued = [];
  for (let i = 0; i < 3; i++) issued.push(...(await planner.batch({ requestId: 'tomorrow' + i })).segments);
  assert.ok(issued.every(x => !x.speech.news && !x.speech.newsText));
});
test('song research cache avoids repeating successful web searches', async () => {
  const { planner, store, searches } = fixture(4);
  await planner.research.all(store.state.library); await planner.research.all(store.state.library);
  assert.equal(searches.length, 4);
});
test('host web search is used with the real DSH service request shape', async () => {
  const { store } = fixture(1); let request;
  const research = new MusicResearch(store, { getWeb: () => ({ search: async r => { request = r; return { sources: [{ title: '访谈', url: 'https://example.com/story', snippet: '已核对的摘要' }] }; } }) });
  const result = await research.song(store.state.library[0]); assert.equal(request.maxResults, 4); assert.ok(request.query.includes('歌曲1')); assert.equal(result.sources[0].summary, '已核对的摘要');
});
test('new defaults and the 0.1 migration use natural voice and the whale persona', () => {
  const { store } = fixture(1); assert.equal(store.state.settings.tts.provider, 'edge'); assert.equal(store.state.settings.hostId, 'whale');
  writeFileSync(join(store.directory, 'state.json'), JSON.stringify({ settings: { tts: { provider: 'browser', voice: '' }, hostId: 'night' } }));
  const migrated = new Store(store.directory); assert.equal(migrated.state.settings.tts.provider, 'edge'); assert.equal(migrated.state.settings.tts.voice, 'zh-CN-XiaoyiNeural'); assert.equal(migrated.state.settings.hostId, 'whale');
});
test('Fish preset sends the verified model, reference voice and prosody', async () => {
  const { store } = fixture(1); store.settings({ tts: { provider: 'fish', apiKey: 'test', model: '' } });
  let request;
  const speech = new Speech(store, { fetchImpl: async (_url, options) => { request = options; return new Response(Buffer.from('MP3'), { headers: { 'Content-Type': 'audio/mpeg' } }); } });
  await speech.prepare('你好，小鲸电台。');
  assert.equal(request.headers.model, 's2.1-pro-free'); const body = JSON.parse(request.body);
  assert.equal(body.reference_id, DAFEIYU_VOICE.id); assert.equal(body.prosody.normalize_loudness, true);
});
test('a selected provider failure never substitutes another voice', async () => {
  const { store } = fixture(1); store.settings({ tts: { provider: 'fish', apiKey: 'test' } });
  let fallbackCalls = 0;
  const speech = new Speech(store, { fetchImpl: async () => { throw new Error('offline'); }, edgeImpl: async () => { fallbackCalls++; return { bytes: Buffer.from('NEURAL'), type: 'audio/mpeg' }; } });
  await assert.rejects(() => speech.prepare('你好'), /offline/); assert.equal(fallbackCalls, 0);
});
test('long-form model budget is forwarded to the actual DSH stream contract', async () => {
  let request;
  await generateText({ mode: 'dsh', provider: 'p', model: 'm' }, { async *stream(r) { request = r; yield { type: 'text-delta', text: '{}' }; } }, 's', {}, undefined, { maxTokens: 12000, timeoutMs: 240000 });
  assert.equal(request.maxTokens, 12000);
});
test('thinking that exhausts the total budget raises a specific output-limit error', async () => {
  const progress = [];
  const llm = { async *stream() { yield { type: 'reasoning-delta', text: 'private internal reasoning' }; yield { type: 'finish', reason: { kind: 'max-tokens' } }; } };
  await assert.rejects(() => generateText({ mode: 'dsh', provider: 'p', model: 'm' }, llm, 'system', {}, undefined, { onProgress: x => progress.push(x) }), error => error.code === 'OUTPUT_LIMIT' && error.reasoningChars > 0);
  assert.ok(!JSON.stringify(progress).includes('private internal reasoning'));
  assert.equal(progress.at(-1).finishKind, 'max-tokens');
});
test('reasoning effort is selected through the actual capability-bound prepared-call contract', async () => {
  let received;
  const llm = {
    stream() { throw new Error('unprepared dispatch'); },
    async prepareCall(config, _signal, configure) {
      const chosen = { ...config, ...configure(config, { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }) };
      return { config: chosen, async *stream(request) { received = request; yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
    },
  };
  await generateText({ mode: 'dsh', provider: 'p', model: 'm' }, llm, 's', {}, undefined, { reasoningEffort: 'low', maxTokens: 24576 });
  assert.equal(received.reasoningEffort, 'low'); assert.equal(received.maxTokens, 24576);
});
test('a truncated director response retries with a larger combined thinking/output budget', async () => {
  const { planner } = fixture(2); const original = planner.generate; const budgets = [];
  planner.generate = async (...args) => {
    if (args[3].stage === 'director') { budgets.push(args[5].maxTokens); if (budgets.length === 1) throw Object.assign(new Error('budget exhausted'), { code: 'OUTPUT_LIMIT' }); }
    return original(...args);
  };
  planner.start(); await planner.preparing;
  assert.equal(planner.job.status, 'ready'); assert.deepEqual(budgets, [32768, 65536]);
});
test('a failed chapter resumes from a persisted draft without repeating the director or completed chapters', async () => {
  const { planner, store, calls } = fixture(20); const original = planner.generate; let fail = true;
  planner.generate = async (...args) => {
    if (args[3].stage === 'script' && args[3].songs[0].position === 9 && fail) throw new Error('temporary transport failure');
    return original(...args);
  };
  planner.start(); await planner.preparing;
  assert.equal(planner.job.status, 'failed'); assert.ok(store.state.programmeDraft.chapters[0]);
  const restored = new Store(store.directory); fail = false;
  const next = new Programme(restored, planner.context, { now: () => now, generate: planner.generate,
    research: new MusicResearch(restored, { now: () => now, search: planner.research.searchImpl }) });
  next.start(); await next.preparing;
  assert.equal(next.job.status, 'ready'); assert.equal(next.current.segments.length, 20);
  assert.equal(calls.filter(x => x.payload.stage === 'director').length, 1);
  assert.equal(calls.filter(x => x.payload.stage === 'script' && x.payload.songs[0].position === 1).length, 1);
  assert.equal(restored.state.programmeDraft, null);
});
test('an uncooperative search provider cannot leave preparation hanging forever', async () => {
  const { store } = fixture(1);
  const research = new MusicResearch(store, { search: () => new Promise(() => {}), timeoutMs: 15 });
  const keepAlive = setTimeout(() => {}, 1000);
  try { const result = await research.song(store.state.library[0]); assert.equal(result.status, 'unavailable'); }
  finally { clearTimeout(keepAlive); }
});
test('TTS synthesis is serialized to avoid a burst of websocket connections', async () => {
  const { store } = fixture(1); let active = 0, peak = 0;
  const speech = new Speech(store, { edgeImpl: async () => { peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 5)); active--; return { bytes: Buffer.from('MP3'), type: 'audio/mpeg' }; } });
  await Promise.all(['opening', 'intro', 'next'].map(x => speech.prepare(x)));
  assert.equal(peak, 1);
});
test('neural speech respects explicit and enabled Windows proxy settings without changing them', async () => {
  assert.equal(await systemProxy({ platform: 'linux', env: { HTTPS_PROXY: 'http://localhost:7890' } }), 'http://localhost:7890/');
  const value = await systemProxy({ platform: 'win32', env: {}, read: async name => name === 'ProxyEnable' ? 'ProxyEnable    REG_DWORD    0x1' : 'ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7891' });
  assert.equal(value, 'http://127.0.0.1:7891/');
});
test('station background bed is a real finite PCM track with soft amplitude', () => {
  const audio = stationBed(); assert.equal(audio.toString('ascii', 0, 4), 'RIFF'); assert.equal(audio.readUInt32LE(24), 22050);
  assert.equal((audio.length - 44) / 2 / 22050, 48);
  let peak = 0; for (let i = 44; i < audio.length; i += 2) peak = Math.max(peak, Math.abs(audio.readInt16LE(i)));
  assert.ok(peak > 500 && peak < 8000);
});
