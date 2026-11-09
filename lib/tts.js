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
    if (cfg.provider !== 'edge' && !(cfg.apiKey || process.env.AI_RADIO_TTS_KEY)) throw Object.assign(new Error((cfg.provider === 'fish' ? 'Fish 音色尚未配置 API Key，请在设置中填写并保存' : '所选语音服务尚未配置 API Key，请在设置中填写并保存')), { code: 'TTS_KEY_MISSING', permanent: true });
    const hash = createHash('sha256').update(JSON.stringify({ text, ...cfg })).digest('hex');
    const voice = cfg.provider === 'fish' ? cfg.fishVoiceId || DAFEIYU_VOICE.id : cfg.voice;
    const hit = this.cache.get(hash);
    if (hit && hit.result.provider === cfg.provider && this.audio.has(hit.id)) return { ...hit.result };
    if (this.pending.has(hash)) return this.pending.get(hash);
    const promise = this.tail.catch(() => {}).then(async () => {
      const file = join(this.directory, hash + '.audio'), meta = join(this.directory, hash + '.json');
      try {
        const saved = JSON.parse(readFileSync(meta, 'utf8'));
        // Earlier versions cached a substitute Edge voice under Fish's settings.
        if (saved.provider !== cfg.provider) throw new Error('Cached audio uses another voice service');
        saved.voice ||= voice;
        const bytes = readFileSync(file); const id = randomUUID();
        this.audio.set(id, { bytes, type: saved.type });
        const result = { ...saved, url: '/dsh-ai-radio/speech/audio/' + id };
        this.cache.set(hash, { id, result });
        while (this.audio.size > 96) this.audio.delete(this.audio.keys().next().value);
        return result;
      } catch { /* First synthesis or an incomplete cache entry. */ }
      if (Date.now() < (this.rateLimitedUntil || 0)) throw Object.assign(new Error('语音服务暂时限流，请稍后再试'), { retryAfter: Math.ceil((this.rateLimitedUntil - Date.now()) / 1000) });
      let audio; const provider = cfg.provider;
      try { audio = await this.synthesize(text, cfg); }
      catch (error) {
        if (cfg.provider === 'edge' && /429/.test(error.message)) { this.rateLimitedUntil = Date.now() + 60000; error.retryAfter = 60; }
        throw error;
      }
      if (!audio.bytes.length || audio.bytes.length > 8_000_000) throw new Error('语音片段大小无效');
      const id = randomUUID(); this.audio.set(id, audio);
      let duration;
      try { duration = (await parseBuffer(audio.bytes, { mimeType: audio.type, size: audio.bytes.length }, { duration: true, skipCovers: true })).format.duration; } catch {}
      const estimatedDuration = Math.max(1, text.length / (4.2 * cfg.rate));
      const saved = { provider, voice, duration: Number.isFinite(duration) ? duration : estimatedDuration, measured: Number.isFinite(duration), estimatedDuration, notice: '', type: audio.type };
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
    let failed = 0, measured = 0, consecutiveFailures = 0, warning = '', unavailable = false;
    progress({ phase: '正在生成主持音频并校准切歌时间', done: 0, total: speeches.length });
    for (const [index, speech] of speeches.entries()) {
      signal.throwIfAborted(); let prepared;
      for (let attempt = 0; attempt < (unavailable || consecutiveFailures >= 3 ? 0 : 2); attempt++) {
        try { prepared = await this.prepare(speech.text); break; }
        catch (error) {
          signal.throwIfAborted();
          warning = error.message;
          if (error.permanent) { unavailable = true; break; }
          if (attempt) break;
          const seconds = Math.min(60, error.retryAfter || 2);
          progress({ detail: '音色服务暂忙，' + seconds + ' 秒后继续；已生成的音频会保留' });
          await new Promise((resolve, reject) => { const timer = setTimeout(done, seconds * 1000); function done() { signal.removeEventListener('abort', abort); resolve(); } function abort() { clearTimeout(timer); reject(signal.reason); } signal.addEventListener('abort', abort, { once: true }); });
        }
      }
      if (prepared && !failed) warning = '';
      speech.duration = prepared?.duration || Math.max(1, speech.text.length / (4.2 * this.store.state.settings.tts.rate));
      speech.timingMeasured = !!prepared?.measured;
      if (prepared?.measured) { measured++; consecutiveFailures = 0; } else if (!prepared) { failed++; consecutiveFailures++; }
      progress({ done: index + 1, total: speeches.length, detail: warning ? warning + '；将保留音乐播放' : '' });
    }
    programme.audioTiming = { measured, total: speeches.length, failed, ...(warning ? { warning } : {}) };
  }
  async synthesize(text, cfg) {
    if (cfg.provider === 'edge') return this.edge(text, cfg);
    const key = cfg.apiKey || process.env.AI_RADIO_TTS_KEY || '';
    if (!key) throw Object.assign(new Error('请在设置中填写所选音色的 API Key'), { code: 'TTS_KEY_MISSING', permanent: true });
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
    if (!response.ok) {
      const name = cfg.provider === 'fish' ? 'Fish 音色' : '所选语音服务';
      const detail = [401, 403].includes(response.status) ? 'API Key 无效或无权使用该音色' : response.status === 402 ? '账号额度或模型访问权限不足' : response.status === 404 ? '音色或接口不存在，请检查音色 ID 和接口地址' : response.status === 429 ? '请求过于频繁，请稍后重试' : '请求失败';
      throw Object.assign(new Error(name + detail + '（HTTP ' + response.status + '）'), { code: 'TTS_HTTP_' + response.status, permanent: [400,401,402,403,404,422].includes(response.status), ...(response.status === 429 ? { retryAfter: 60 } : {}) });
    }
    const bytes = Buffer.from(await response.arrayBuffer()); const type = response.headers.get('content-type') || 'audio/mpeg';
    if (!bytes.length || !/audio|octet-stream/.test(type)) throw new Error('语音服务未返回音频');
    return { bytes, type };
  }
}
