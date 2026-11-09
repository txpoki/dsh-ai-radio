import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Store, HOSTS, cleanText } from './store.js';
import { Music } from './music.js';
import { Context } from './context.js';
import { Planner } from './planner.js';
import { Speech, VOICES } from './tts.js';
import { publicFetch } from './network.js';

const PREFIX = '/dsh-ai-radio';
export function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function readBody(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 64000) throw new Error('请求内容过大'); chunks.push(chunk); }
  return bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
export class RadioService {
  constructor({ directory, llm, store, music, context, speech, planner, demo = false } = {}) {
    this.store = store || new Store(directory); this.llm = llm; this.demo = demo;
    this.music = music || new Music(this.store);
    this.context = context || new Context(this.store);
    this.speech = speech || new Speech(this.store);
    this.planner = planner || new Planner(this.store, this.context, { llm });
    this.commands = []; this.sequence = 0; this.issued = new Map(); this.qrKeys = new Map(); this.disposed = false;
    this.handler = this.handler.bind(this);
  }
  command(action, query) {
    const command = { id: ++this.sequence, action, query: cleanText(query, 150), at: Date.now() };
    this.commands.push(command); this.commands = this.commands.slice(-20); return command;
  }
  async models() {
    if (!this.llm?.listProviders) return [];
    const providers = this.llm.listProviders();
    const result = await Promise.all(providers.map(async p => ({ ...p, models: await this.llm.listModels(p.id).then(xs => xs.map(x => ({ id: x.id, name: x.name || x.id }))).catch(() => []) })));
    const config = this.store.state.settings.llm;
    if (config.mode === 'dsh' && !config.provider && !config.model) {
      const provider = result.find(p => /deepseek/i.test(p.id) && p.models.length) || result.find(p => p.models.length);
      const model = provider?.models.find(m => /chat|flash|mini/i.test(m.id)) || provider?.models[0];
      if (provider && model) this.store.settings({ llm: { provider: provider.id, model: model.id } });
    }
    return result;
  }
  async handler(req, res) {
    if (this.disposed) return json(res, { error: '插件已卸载' }, 503);
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.slice(PREFIX.length);
      if (!url.pathname.startsWith(PREFIX + '/')) return json(res, { error: '接口不存在' }, 404);
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) return json(res, { error: '不支持此方法' }, 405);
      if (req.headers.origin) {
        let origin; try { origin = new URL(req.headers.origin); } catch { return json(res, { error: '来源无效' }, 403); }
        if (origin.host !== req.headers.host) return json(res, { error: '来源不匹配' }, 403);
      }
      if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, { error: '需要 JSON 请求' }, 415);
      const body = req.method === 'POST' ? await readBody(req) : {};
      const state = this.store.state;
      if (path === '/bootstrap' && req.method === 'GET') return json(res, { version: '0.1.0', demo: this.demo, account: state.account, settings: this.store.publicSettings(), hosts: HOSTS, voices: VOICES, playlists: state.playlists, libraryCount: state.library.length, librarySyncedAt: state.librarySyncedAt || null, playback: state.playback, resumeTrack: state.library.find(s => s.id === state.playback?.songId) || null, history: state.history.slice(0, 40), commandSequence: this.sequence, notices: this.store.loadError ? [this.store.loadError] : [] });
      if (path === '/models' && req.method === 'GET') return json(res, await this.models());
      if (path === '/settings' && req.method === 'POST') { this.planner.inflight.clear(); return json(res, this.store.settings(body)); }
      if (path === '/login/qr' && req.method === 'POST') {
        const result = await this.music.qr(); this.qrKeys.set(result.key, result.expiresAt); return json(res, result);
      }
      if (path === '/login/poll' && req.method === 'POST') {
        if ((this.qrKeys.get(String(body.key)) || 0) < Date.now()) throw new Error('二维码已过期，请刷新');
        const result = await this.music.poll(body.key);
        if (result.status === 'success' || result.status === 'expired') this.qrKeys.delete(String(body.key));
        return json(res, result);
      }
      if (path === '/login/cookie' && req.method === 'POST') {
        if (typeof body.cookie !== 'string' || body.cookie.length > 12000 || !body.cookie.includes('MUSIC_U=')) throw new Error('请输入包含 MUSIC_U 的网易云 Cookie');
        await this.music.login(body.cookie); this.planner.inflight.clear(); return json(res, { account: state.account });
      }
      if (path === '/logout' && req.method === 'POST') { this.music.logout(); this.planner.inflight.clear(); this.issued.clear(); return json(res, { ok: true }); }
      if (path === '/playlists' && req.method === 'GET') return json(res, url.searchParams.has('refresh') ? await this.music.syncPlaylists() : state.playlists);
      if (path === '/library' && req.method === 'POST') {
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter(x => /^\d+$/.test(x)))].slice(0, 30);
        if (!ids.length) throw new Error('请至少选择一个歌单');
        const result = await this.music.loadLibrary(ids); this.planner.lastSelected = []; this.planner.inflight.clear(); return json(res, result);
      }
      if (path === '/context' && req.method === 'GET') return json(res, await this.context.assemble());
      if (path === '/plan' && req.method === 'POST') {
        const result = await this.planner.batch(body);
        for (const segment of result.segments) if (segment.speech) this.issued.set(segment.speech.id, segment.speech);
        while (this.issued.size > 200) this.issued.delete(this.issued.keys().next().value);
        return json(res, result);
      }
      if (path === '/speech/prepare' && req.method === 'POST') {
        const speech = body.preview ? { text: '你好，这里是你的私人音乐电台。接下来，把时间交给音乐。' } : this.issued.get(String(body.id));
        if (!speech) throw new Error('主持片段不存在或已过期');
        return json(res, await this.speech.prepare(speech.text));
      }
      if (path === '/speech/heard' && req.method === 'POST') {
        this.planner.heard(this.issued.get(String(body.id))); return json(res, { ok: true });
      }
      if (path.startsWith('/speech/audio/') && ['GET', 'HEAD'].includes(req.method)) {
        const audio = this.speech.audio.get(path.split('/').pop());
        if (!audio) return json(res, { error: '语音缓存已过期' }, 404);
        res.writeHead(200, { 'Content-Type': audio.type, 'Content-Length': audio.bytes.length, 'Cache-Control': 'private, max-age=3600' }); return res.end(req.method === 'HEAD' ? undefined : audio.bytes);
      }
      if (path === '/history' && req.method === 'GET') return json(res, state.history.slice(0, 100));
      if (path === '/event' && req.method === 'POST') {
        this.store.event(body); if (body.action === 'failed') this.planner.failure(body.songId); return json(res, { ok: true });
      }
      if (path === '/playback' && req.method === 'POST') {
        state.playback = { songId: cleanText(body.songId, 30), position: Math.max(0, Math.min(7200, Number(body.position) || 0)), at: Date.now() }; this.store.save(); return json(res, { ok: true });
      }
      if (path === '/commands' && req.method === 'GET') return json(res, this.commands.filter(x => x.id > (Number(url.searchParams.get('after')) || 0) && Date.now() - x.at < 60000));
      const trackMatch = /^\/track\/(\d+)\/audio$/.exec(path);
      if (trackMatch && ['GET', 'HEAD'].includes(req.method)) return await this.streamTrack(trackMatch[1], req, res);
      return json(res, { error: '接口不存在' }, 404);
    } catch (error) {
      if (!res.headersSent) json(res, { error: cleanText(error.message || '电台暂时不可用', 220), ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, 400);
      else res.destroy();
    }
  }
  async streamTrack(id, req, res) {
    const abort = new AbortController(); res.on('close', () => abort.abort());
    let upstream;
    for (let attempt = 0; attempt < 2; attempt++) {
      const track = await this.music.stream(id, attempt > 0);
      upstream = await publicFetch(track.url, { method: req.method, signal: abort.signal, headers: { ...(req.headers.range ? { Range: req.headers.range } : {}), Referer: 'https://music.163.com/' } }, { domains: ['music.126.net', 'music.163.com', 'music.126.com'], timeoutMs: 30 * 60000 });
      if (upstream.ok || upstream.status === 416) break;
      await upstream.body?.cancel();
    }
    if (!upstream.ok && upstream.status !== 416) throw new Error('歌曲音频暂时不可用');
    const headers = { 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' };
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (upstream.headers.get(key)) headers[key] = upstream.headers.get(key);
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    await pipeline(Readable.fromWeb(upstream.body), res);
  }
  dispose() { this.disposed = true; this.planner.inflight.clear(); this.speech.audio.clear(); }
}
