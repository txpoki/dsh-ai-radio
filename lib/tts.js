import { createHash, randomUUID } from 'node:crypto';

export const VOICES = [
  { id: 'nova', name: 'Nova · 明亮女声' }, { id: 'shimmer', name: 'Shimmer · 温柔女声' },
  { id: 'alloy', name: 'Alloy · 自然中性' }, { id: 'echo', name: 'Echo · 清晰男声' },
  { id: 'onyx', name: 'Onyx · 沉稳男声' }, { id: 'fable', name: 'Fable · 叙事音色' },
];
export class Speech {
  constructor(store, { fetchImpl = fetch } = {}) { this.store = store; this.fetch = fetchImpl; this.cache = new Map(); this.pending = new Map(); this.audio = new Map(); }
  async prepare(text) {
    const cfg = this.store.state.settings.tts;
    if (cfg.provider === 'browser') return { provider: 'browser', text, voice: cfg.voice, language: cfg.language, rate: cfg.rate };
    const hash = createHash('sha256').update(JSON.stringify({ text, ...cfg })).digest('hex');
    const hit = this.cache.get(hash);
    if (hit && this.audio.has(hit.id)) return { provider: cfg.provider, url: '/dsh-ai-radio/speech/audio/' + hit.id };
    if (this.pending.has(hash)) return this.pending.get(hash);
    const promise = this.synthesize(text, cfg).then(({ bytes, type }) => {
      if (bytes.length > 8_000_000) throw new Error('语音片段过长');
      const id = randomUUID(); this.audio.set(id, { bytes, type }); this.cache.set(hash, { id });
      while (this.audio.size > 64) { const old = this.audio.keys().next().value; this.audio.delete(old); }
      if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value);
      return { provider: cfg.provider, url: '/dsh-ai-radio/speech/audio/' + id };
    }).finally(() => this.pending.delete(hash));
    this.pending.set(hash, promise); return promise;
  }
  async synthesize(text, cfg) {
    const key = cfg.apiKey || process.env.AI_RADIO_TTS_KEY || '';
    if (!key) throw new Error('未配置语音 API Key，将使用系统音色');
    let url, body, headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    if (cfg.provider === 'fish') {
      if (!cfg.fishVoiceId) throw new Error('请填写 Fish 音色 ID');
      url = (cfg.baseUrl || 'https://api.fish.audio').replace(/\/$/, '') + '/v1/tts';
      body = { text, reference_id: cfg.fishVoiceId, format: 'mp3', latency: 'normal' };
      headers.model = cfg.model && cfg.model !== 'tts-1' ? cfg.model : 's1';
    } else {
      url = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/audio/speech';
      body = { model: cfg.model || 'tts-1', input: text, voice: cfg.voice || 'nova', response_format: 'mp3', speed: cfg.rate };
    }
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('语音接口地址无效');
    const response = await this.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('语音服务返回 HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') || 'audio/mpeg';
    if (!bytes.length || !/audio|octet-stream/.test(type)) throw new Error('语音服务未返回音频');
    return { bytes, type };
  }
}
