import { createHash, randomUUID } from 'node:crypto';
import { EdgeTTS } from 'node-edge-tts';
import { systemProxy } from './proxy.js';
import { parseBuffer } from 'music-metadata';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const DAFEIYU_VOICE = { id: 'fe50cdf3040449298470d58ff0991e1d', name: '蓝色大肥鱼', provider: 'fish', model: 's2.1-pro-free',
  source: 'https://github.com/zbsdsb/dafeiyu-ai-vtuber/blob/dafeiyu/config.json' };
export const EDGE_VOICES = [
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 · 明亮少女' },
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 · 自然亲切' },
  { id: 'zh-CN-XiaoshuangNeural', name: '晓双 · 轻快活泼' },
  { id: 'zh-CN-XiaomengNeural', name: '晓梦 · 柔和清澈' },
];
export const VOICES = [
  { id: 'nova', name: 'Nova · 明亮女声' }, { id: 'shimmer', name: 'Shimmer · 温柔女声' },
  { id: 'alloy', name: 'Alloy · 自然中性' }, { id: 'echo', name: 'Echo · 清晰男声' },
];
export async function edgeSynthesize(text, cfg) {
  const proxy = await systemProxy();
  const tts = new EdgeTTS({ voice: /^zh-[A-Za-z-]+Neural$/.test(cfg.voice) ? cfg.voice : 'zh-CN-XiaoyiNeural',
    lang: cfg.language || 'zh-CN', rate: (Math.round(((cfg.rate || 1) - 1) * 100) >= 0 ? '+' : '') + Math.round(((cfg.rate || 1) - 1) * 100) + '%',
    pitch: /^[+-]?\d{1,2}(Hz|%)$/.test(cfg.pitch) ? cfg.pitch : '+5Hz',
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3', timeout: 45000, proxy });
  const chunks = []; let size = 0;
  for await (const chunk of tts.streamAudio(text)) {
    if (!Buffer.isBuffer(chunk)) continue;
    size += chunk.length; if (size > 8_000_000) throw new Error('语音片段过长');
    chunks.push(chunk);
  }
  if (!size) throw new Error('自然音色服务未返回音频');
  return { bytes: Buffer.concat(chunks), type: 'audio/mpeg' };
}
export class Speech {
  constructor(store, { fetchImpl = fetch, edgeImpl = edgeSynthesize } = {}) {
    this.store = store; this.fetch = fetchImpl; this.edge = edgeImpl; this.cache = new Map(); this.pending = new Map(); this.audio = new Map(); this.tail = Promise.resolve();
    this.directory = join(store.directory, 'speech-cache'); mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  async prepare(text) {
    const cfg = structuredClone(this.store.state.settings.tts);
    if (cfg.provider === 'browser') return { provider: 'browser', text, voice: cfg.voice, language: cfg.language, rate: cfg.rate };
    const hash = createHash('sha256').update(JSON.stringify({ text, ...cfg })).digest('hex');
    const hit = this.cache.get(hash);
    if (hit && this.audio.has(hit.id)) return { ...hit.result };
    if (this.pending.has(hash)) return this.pending.get(hash);
    const promise = this.tail.catch(() => {}).then(async () => {
      const file = join(this.directory, hash + '.audio'), meta = join(this.directory, hash + '.json');
      try {
        const saved = JSON.parse(readFileSync(meta, 'utf8'));
        const bytes = readFileSync(file); const id = randomUUID();
        this.audio.set(id, { bytes, type: saved.type });
        const result = { ...saved, url: '/dsh-ai-radio/speech/audio/' + id };
        this.cache.set(hash, { id, result });
        while (this.audio.size > 96) this.audio.delete(this.audio.keys().next().value);
        return result;
      } catch { /* First synthesis or an incomplete cache entry. */ }
      if (Date.now() < (this.rateLimitedUntil || 0)) throw Object.assign(new Error('语音服务暂时限流，请稍后再试'), { retryAfter: Math.ceil((this.rateLimitedUntil - Date.now()) / 1000) });
      let audio; let provider = cfg.provider; let notice = '';
      try { audio = await this.synthesize(text, cfg); }
      catch (error) {
        if (cfg.provider === 'edge' && /429/.test(error.message)) { this.rateLimitedUntil = Date.now() + 60000; error.retryAfter = 60; }
        if (cfg.provider === 'edge') throw error;
        audio = await this.edge(text, { ...cfg, voice: 'zh-CN-XiaoyiNeural', pitch: '+5Hz' });
        provider = 'edge'; notice = '所选音色暂时不可用，本段使用晓伊自然女声。';
      }
      if (!audio.bytes.length || audio.bytes.length > 8_000_000) throw new Error('语音片段大小无效');
      const id = randomUUID(); this.audio.set(id, audio);
      let duration;
      try { duration = (await parseBuffer(audio.bytes, { mimeType: audio.type, size: audio.bytes.length }, { duration: true, skipCovers: true })).format.duration; } catch {}
      const estimatedDuration = Math.max(1, text.length / (4.2 * cfg.rate));
      const saved = { provider, duration: Number.isFinite(duration) ? duration : estimatedDuration, measured: Number.isFinite(duration), estimatedDuration, notice, type: audio.type };
      const temporary = file + '.tmp'; writeFileSync(temporary, audio.bytes, { mode: 0o600 }); renameSync(temporary, file);
      writeFileSync(meta, JSON.stringify(saved), { mode: 0o600 });
      const result = { ...saved, url: '/dsh-ai-radio/speech/audio/' + id };
      this.cache.set(hash, { id, result });
      while (this.audio.size > 96) this.audio.delete(this.audio.keys().next().value);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
      if (this.cache.size % 50 === 0) this.trimDiskCache();
      return result;
    }).finally(() => this.pending.delete(hash));
    this.tail = promise;
    this.pending.set(hash, promise); return promise;
  }
  trimDiskCache() {
    const files = readdirSync(this.directory).filter(x => /^[a-f0-9]{64}\.audio$/.test(x)).map(name => ({ name, ...statSync(join(this.directory, name)) })).sort((a,b) => a.mtimeMs - b.mtimeMs);
    let size = files.reduce((n,x) => n + x.size, 0);
    for (const item of files) { if (size < 750_000_000) break; unlinkSync(join(this.directory, item.name)); try { unlinkSync(join(this.directory, item.name.replace(/\.audio$/, '.json'))); } catch {} size -= item.size; }
  }
  async prepareProgramme(programme, { signal, progress }) {
    const speeches = [programme.opening, ...programme.segments.map(x => x.speech)].filter(Boolean);
    let failed = 0, measured = 0, consecutiveFailures = 0;
    progress({ phase: '正在生成主持音频并校准切歌时间', done: 0, total: speeches.length });
    for (const [index, speech] of speeches.entries()) {
      signal.throwIfAborted(); let prepared;
      for (let attempt = 0; attempt < (consecutiveFailures >= 3 ? 0 : 2); attempt++) {
        try { prepared = await this.prepare(speech.text); break; }
        catch (error) {
          signal.throwIfAborted();
          if (attempt) break;
          const seconds = Math.min(60, error.retryAfter || 2);
          progress({ detail: '音色服务暂忙，' + seconds + ' 秒后继续；已生成的音频会保留' });
          await new Promise((resolve, reject) => { const timer = setTimeout(done, seconds * 1000); function done() { signal.removeEventListener('abort', abort); resolve(); } function abort() { clearTimeout(timer); reject(signal.reason); } signal.addEventListener('abort', abort, { once: true }); });
        }
      }
      speech.duration = prepared?.duration || Math.max(1, speech.text.length / (4.2 * this.store.state.settings.tts.rate));
      speech.timingMeasured = !!prepared?.measured;
      if (prepared?.measured) { measured++; consecutiveFailures = 0; } else if (!prepared) { failed++; consecutiveFailures++; }
      progress({ done: index + 1, total: speeches.length, detail: '' });
    }
    programme.audioTiming = { measured, total: speeches.length, failed };
  }
  async synthesize(text, cfg) {
    if (cfg.provider === 'edge') return this.edge(text, cfg);
    const key = cfg.apiKey || process.env.AI_RADIO_TTS_KEY || '';
    if (!key) throw new Error('请在设置中填写所选音色的 API Key');
    let url, body; const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    if (cfg.provider === 'fish') {
      url = (cfg.baseUrl || 'https://api.fish.audio').replace(/\/$/, '') + '/v1/tts';
      body = { text, reference_id: cfg.fishVoiceId || DAFEIYU_VOICE.id, format: 'mp3', latency: 'normal', normalize: true,
        prosody: { speed: cfg.rate || 1, volume: 0, normalize_loudness: true }, temperature: 0.7, top_p: 0.7 };
      headers.model = cfg.model && cfg.model !== 'tts-1' ? cfg.model : DAFEIYU_VOICE.model;
    } else {
      url = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/audio/speech';
      body = { model: cfg.model || 'tts-1', input: text, voice: cfg.voice || 'nova', response_format: 'mp3', speed: cfg.rate };
    }
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('语音接口地址无效');
    const response = await this.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('语音服务返回 HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer()); const type = response.headers.get('content-type') || 'audio/mpeg';
    if (!bytes.length || !/audio|octet-stream/.test(type)) throw new Error('语音服务未返回音频');
    return { bytes, type };
  }
}
