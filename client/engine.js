const BASE = '/dsh-ai-radio';
const uid = () => crypto.randomUUID();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function api(path, body, timeout = 45000) {
  const response = await fetch(BASE + path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '电台连接暂时不可用'); error.retryAfter = result.retryAfter; throw error; }
  return result;
}
export function equalPower(size = 64) {
  return { incoming: Float32Array.from({ length: size }, (_, i) => Math.sin(i / (size - 1) * Math.PI / 2)), outgoing: Float32Array.from({ length: size }, (_, i) => Math.cos(i / (size - 1) * Math.PI / 2)) };
}
export class RadioController {
  constructor() {
    this.listeners = new Set(); this.queue = []; this.current = -1; this.running = false; this.generation = 0; this.voiceGeneration = 0; this.disposed = false;
    this.state = { loading: true, status: 'idle', expanded: false, page: 'radio', track: null, speech: null, position: 0, duration: 0, queue: [], notice: '', context: null, batchMode: '', settings: null, history: [], spokenCount: 0, transitions: 0 };
    this.decks = [0,1].map(index => {
      const audio = new Audio(); audio.preload = 'auto'; audio.setAttribute('playsinline', '');
      const deck = { audio, index, segment: null, eventId: '', recorded: false };
      audio.addEventListener('ended', () => { if (this.current === index && this.running) this.advance().catch(e => this.retry(e)); });
      audio.addEventListener('timeupdate', () => this.tick());
      audio.addEventListener('error', () => { if (this.current === index && deck.segment && this.running && !this.advancing) this.failCurrent(); });
      return deck;
    });
    this.voiceAudio = new Audio(); this.voiceAudio.setAttribute('playsinline', ''); this.speechCache = new Map();
    this.timer = setInterval(() => this.tick(), 1000);
    this.commandTimer = setInterval(() => this.pollCommands(), 2000);
    this.online = () => { if (this.running && this.state.status === 'retrying') { clearTimeout(this.retryTimer); this.advance().catch(e => this.retry(e)); } };
    window.addEventListener('online', this.online);
    this.visibility = () => { if (this.audioContext?.state === 'suspended' && this.running) this.audioContext.resume().catch(() => {}); };
    document.addEventListener('visibilitychange', this.visibility);
  }
  subscribe = fn => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  snapshot = () => this.state;
  emit(patch) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  async init() {
    try {
      const data = await api('/bootstrap'); this.commandAfter = data.commandSequence;
      this.emit({ ...data, loading: false, status: 'idle' });
      this.models = await api('/models').catch(() => []);
      const updated = this.models.length ? await api('/bootstrap') : {};
      this.emit({ ...updated, models: this.models });
      api('/context').then(context => !this.disposed && this.emit({ context })).catch(() => {});
    } catch (error) { this.emit({ loading: false, notice: error.message }); }
  }
  async refresh() { const data = await api('/bootstrap'); this.emit({ ...data }); return data; }
  async saveSettings(patch) {
    const previous = this.state.settings;
    const settings = await api('/settings', patch);
    const replan = ['hostId', 'city', 'timezone', 'interests', 'extraContext', 'llm', 'speechEvery', 'humorEvery', 'newsMinutes'].some(key => JSON.stringify(previous[key]) !== JSON.stringify(settings[key]));
    if (replan) { this.generation++; this.queue = []; }
    if (JSON.stringify(previous.tts) !== JSON.stringify(settings.tts)) this.speechCache.clear();
    this.emit({ settings, ...(replan ? { queue: [] } : {}) });
    if (this.audioContext) { this.master.gain.setTargetAtTime(settings.volume, this.audioContext.currentTime, 0.1); this.voiceGain.gain.value = settings.speechVolume; }
    if (this.running) this.prepareNext();
    return settings;
  }
  async loadLibrary(ids) {
    this.stop(); const result = await api('/library', { ids }, 180000); await this.refresh();
    this.emit({ notice: `已载入 ${result.count} 首歌曲${result.failures.length ? '，部分歌单读取失败' : ''}` }); return result;
  }
  graph() {
    if (this.audioContext) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.audioContext = new Context(); const ctx = this.audioContext;
    this.master = ctx.createGain(); this.master.gain.value = this.state.settings?.volume ?? 0.75;
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.voiceGain = ctx.createGain(); this.voiceGain.gain.value = this.state.settings?.speechVolume ?? 1; this.voiceGain.connect(this.master);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 128; this.master.connect(this.analyser); this.analyser.connect(ctx.destination);
    for (const deck of this.decks) { deck.gain = ctx.createGain(); deck.gain.gain.value = 0; ctx.createMediaElementSource(deck.audio).connect(deck.gain); deck.gain.connect(this.musicBus); }
    ctx.createMediaElementSource(this.voiceAudio).connect(this.voiceGain);
  }
  unlock() {
    this.graph(); this.audioContext?.resume().catch(() => {});
    if (!this.unlocked) {
      this.unlocked = true;
      // Prime each element inside the original click for browsers that require it.
      const silent = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';
      for (const audio of [...this.decks.map(x => x.audio), this.voiceAudio]) { audio.src = silent; audio.play().then(() => { if (!this.running) audio.pause(); }).catch(() => {}); }
    }
  }
  async acquire() {
    if (this.releaseLock) return true;
    if (!navigator.locks) return true;
    return new Promise(resolve => {
      navigator.locks.request('dsh-ai-radio-audio-owner', { ifAvailable: true }, async lock => {
        if (!lock) { resolve(false); return; }
        await new Promise(release => { this.releaseLock = () => { release(); this.releaseLock = null; }; resolve(true); });
      }).catch(() => resolve(false));
    });
  }
  async play(query = '') {
    this.unlock();
    if (!this.state.settings) return;
    if (!this.state.libraryCount) { this.emit({ expanded: true, page: 'library', notice: '先登录网易云并选择歌单，就可以开台。' }); return; }
    if (!await this.acquire()) { this.emit({ notice: '电台正在另一个标签页播放，请先在那里暂停。' }); return; }
    this.running = true; clearTimeout(this.retryTimer);
    if (this.current >= 0 && this.decks[this.current].segment && !query) {
      try {
        await this.decks[this.current].audio.play();
        if (this.state.speech) { if (this.voiceAudio.src && !this.voiceAudio.ended) this.voiceAudio.play().catch(() => {}); window.speechSynthesis?.resume(); }
        this.emit({ status: 'playing', notice: '' }); this.lastProgressAt = Date.now(); this.prepareNext(); return;
      } catch (error) { this.pause(); this.emit({ notice: '请再点击一次播放以启用声音。' }); return; }
    }
    this.emit({ status: 'preparing', notice: '' }); this.nextQuery = query;
    if (query) { this.queue = []; this.generation++; }
    if (!query && this.current < 0 && !this.queue.length && this.state.resumeTrack && this.state.playback?.position > 2) {
      this.queue.push({ id: uid(), track: this.state.resumeTrack, speech: null, seekTo: this.state.playback.position });
      this.emit({ resumeTrack: null });
    }
    try { await this.advance(); } catch (error) { this.retry(error); }
  }
  pause() {
    this.running = false; for (const deck of this.decks) deck.audio.pause(); this.voiceAudio.pause(); window.speechSynthesis?.pause();
    clearTimeout(this.retryTimer); this.savePosition(); this.releaseLock?.(); this.emit({ status: 'paused' });
  }
  stop() {
    this.pause(); this.generation++; this.cancelSpeech(); this.queue = []; this.current = -1;
    clearTimeout(this.fadeTimer); this.crossfading = false;
    for (const deck of this.decks) { deck.segment = null; deck.audio.removeAttribute('src'); deck.audio.load(); }
    this.emit({ status: 'idle', track: null, queue: [], position: 0, duration: 0, speech: null });
  }
  async next() {
    if (!this.running) return this.play();
    this.recordCurrent('skipped'); this.cancelSpeech();
    try { await this.advance(); } catch (error) { this.retry(error); }
  }
  async ensureQueue() {
    if (this.queue.length > 1) return;
    if (this.filling) return this.filling;
    const generation = this.generation;
    const query = this.nextQuery || ''; this.nextQuery = '';
    this.filling = api('/plan', { requestId: uid(), opening: this.current < 0, query }).then(batch => {
      if (this.disposed || generation !== this.generation) return;
      this.queue.push(...batch.segments); this.emit({ queue: [...this.queue], context: batch.context, host: batch.host, batchMode: batch.mode, notice: batch.notice || '' });
    }).finally(() => { this.filling = null; });
    return this.filling;
  }
  async prepareDeck(deck, segment) {
    if (deck.segment?.id === segment.id && deck.audio.readyState >= 1) return;
    deck.audio.pause(); deck.segment = null;
    const audio = deck.audio;
    await new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', ready); audio.removeEventListener('error', fail); };
      const ready = () => { clean(); resolve(); };
      const fail = () => { clean(); reject(new Error('这首歌的音频暂时不可用')); };
      const timer = setTimeout(fail, 14000);
      audio.addEventListener('loadedmetadata', ready); audio.addEventListener('error', fail);
      audio.src = `${BASE}/track/${encodeURIComponent(segment.track.id)}/audio?play=${encodeURIComponent(segment.id)}`; audio.load();
    });
    deck.segment = segment; deck.eventId = uid(); deck.recorded = false;
  }
  prepareSpeech(speech) {
    if (!speech) return Promise.resolve(null);
    const key = speech.id + JSON.stringify(this.state.settings.tts);
    if (!this.speechCache.has(key)) {
      this.speechCache.set(key, api('/speech/prepare', { id: speech.id }, 18000).catch(error => ({ provider: 'browser', text: speech.text, ...this.state.settings.tts, error: error.message, fallback: true })));
      if (this.speechCache.size > 30) this.speechCache.delete(this.speechCache.keys().next().value);
    }
    return this.speechCache.get(key);
  }
  async prepareNext() {
    if (!this.running || this.preparingNext || this.crossfading) return;
    const generation = this.generation;
    this.preparingNext = true; let segment;
    try {
      await this.ensureQueue(); segment = this.queue[0];
      if (!segment || generation !== this.generation || !this.running || this.current < 0) return;
      this.prepareSpeech(segment.speech);
      const deck = this.decks[1 - this.current];
      await this.prepareDeck(deck, segment);
    } catch (error) {
      if (segment && generation === this.generation && this.queue[0]?.id === segment.id) { this.report(segment, 'failed'); this.queue.shift(); this.emit({ queue: [...this.queue] }); }
    } finally { this.preparingNext = false; }
  }
  advance() {
    if (this.advancing) return this.advancing;
    this.advancing = this._advance().finally(() => { this.advancing = null; if (this.running) this.prepareNext(); }); return this.advancing;
  }
  async _advance() {
    const generation = this.generation;
    for (let attempts = 0; attempts < 8 && this.running; attempts++) {
      if (!this.queue.length) { await this.ensureQueue(); if (generation !== this.generation) return; }
      if (!this.queue.length) throw new Error('正在准备下一段节目');
      const segment = this.queue[0]; const previous = this.current < 0 ? null : this.decks[this.current];
      const deck = this.decks[this.current < 0 ? 0 : 1 - this.current];
      try {
        // A preload can still be loading. Reuse its media request rather than changing src twice.
        if (this.preparingNext) { for (let i = 0; i < 150 && this.preparingNext; i++) await wait(100); }
        await this.prepareDeck(deck, segment);
        if (!this.running || generation !== this.generation) return;
        if (segment.seekTo && Number.isFinite(deck.audio.duration)) { deck.audio.currentTime = Math.min(segment.seekTo, Math.max(0, deck.audio.duration - 2)); segment.seekTo = 0; }
        if (this.audioContext) { deck.gain.gain.cancelScheduledValues(this.audioContext.currentTime); deck.gain.gain.value = previous && !previous.audio.ended ? 0 : 1; }
        await deck.audio.play();
        if (!this.running || generation !== this.generation) { deck.audio.pause(); return; }
        this.recordCurrent('played'); this.cancelSpeech();
        this.queue.shift(); this.current = deck.index; this.failureCount = 0; this.lastProgressAt = Date.now(); this.lastPosition = 0;
        this.fade(previous, deck);
        this.emit({ track: segment.track, status: 'playing', queue: [...this.queue], position: 0, duration: deck.audio.duration || segment.track.interval, transitions: this.state.transitions + 1 });
        this.setMediaSession(); this.savePosition();
        if (segment.speech) this.say(segment.speech).catch(() => {});
        return;
      } catch (error) {
        if (error.name === 'NotAllowedError') { this.pause(); this.emit({ notice: '浏览器需要你再次点击播放以启用声音。' }); return; }
        this.report(segment, 'failed'); if (this.queue[0]?.id === segment.id) this.queue.shift();
        this.emit({ notice: error.message, queue: [...this.queue] });
      }
    }
    if (this.running) throw new Error('连续多首无法播放，稍后自动重试');
  }
  fade(previous, incoming) {
    clearTimeout(this.fadeTimer);
    if (!previous || previous === incoming || previous.audio.ended || !this.state.settings.crossfadeSeconds) {
      if (previous && previous !== incoming) { previous.audio.pause(); previous.segment = null; }
      if (incoming.gain) incoming.gain.gain.value = 1;
      return;
    }
    const seconds = Math.min(this.state.settings.crossfadeSeconds, Math.max(0.1, previous.audio.duration - previous.audio.currentTime), Math.max(0.1, incoming.audio.duration / 2));
    this.crossfading = true;
    if (this.audioContext) {
      const now = this.audioContext.currentTime; const curves = equalPower();
      for (const deck of [previous, incoming]) deck.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueCurveAtTime(curves.outgoing, now, seconds);
      incoming.gain.gain.setValueCurveAtTime(curves.incoming, now, seconds);
    } else { previous.audio.volume = 0.15; incoming.audio.volume = this.state.settings.volume; }
    this.fadeTimer = setTimeout(() => { previous.audio.pause(); previous.segment = null; this.crossfading = false; this.prepareNext(); }, seconds * 1000 + 50);
  }
  duck(talking) {
    const settings = this.state.settings || { duckVolume: 0.18, volume: 0.75 };
    const value = talking ? settings.duckVolume : 1;
    if (this.audioContext) { const gain = this.musicBus.gain; gain.cancelScheduledValues(this.audioContext.currentTime); gain.setTargetAtTime(value, this.audioContext.currentTime, talking ? 0.18 : 0.6); }
    else for (const deck of this.decks) deck.audio.volume = value * settings.volume;
  }
  cancelSpeech() {
    this.voiceGeneration++; this.voiceAudio.pause(); window.speechSynthesis?.cancel(); this.voiceCancel?.(); this.voiceCancel = null;
    this.duck(false); if (this.state.speech) this.emit({ speech: null });
  }
  async say(speech, preview = false) {
    const token = ++this.voiceGeneration;
    const prepared = preview ? await api('/speech/prepare', { preview: true }) : await this.prepareSpeech(speech);
    if (token !== this.voiceGeneration || (!preview && !this.running)) return;
    this.duck(true); this.emit({ speech });
    if (prepared.error) this.emit({ notice: prepared.error + '；本段改用系统音色。' });
    let success = false;
    try {
      success = await new Promise(resolve => {
        let timer;
        const done = ok => { clearTimeout(timer); this.voiceAudio.onended = null; this.voiceAudio.onerror = null; resolve(ok); };
        this.voiceCancel = () => done(false);
        const arm = () => { timer = setTimeout(() => { if (!preview && !this.running) arm(); else done(false); }, 90000); }; arm();
        if (prepared.url) {
          this.voiceAudio.src = prepared.url; this.voiceAudio.onended = () => done(true); this.voiceAudio.onerror = () => done(false); this.voiceAudio.play().catch(() => done(false));
        } else {
          if (!window.speechSynthesis) { done(false); return; }
          const utterance = new SpeechSynthesisUtterance(speech.text);
          const voices = window.speechSynthesis.getVoices(); const cfg = this.state.settings.tts;
          utterance.voice = voices.find(v => v.voiceURI === cfg.voice || v.name === cfg.voice) || voices.find(v => v.lang.startsWith('zh')) || null;
          utterance.lang = cfg.language || 'zh-CN'; utterance.rate = cfg.rate || 1; utterance.volume = this.state.settings.speechVolume * this.state.settings.volume;
          utterance.onend = () => done(true); utterance.onerror = () => done(false); window.speechSynthesis.speak(utterance);
        }
      });
    } finally {
      if (token === this.voiceGeneration) { this.duck(false); this.emit({ speech: null, spokenCount: this.state.spokenCount + (success ? 1 : 0) }); }
    }
    if (success && !preview) api('/speech/heard', { id: speech.id }).catch(() => {});
    if (!success && token === this.voiceGeneration && this.running) this.emit({ notice: '这段口播暂时无法播放，音乐继续。可在设置中切换音色服务。' });
  }
  previewVoice() { this.unlock(); this.cancelSpeech(); return this.say({ id: 'preview', text: '你好，这里是你的私人音乐电台。接下来，把时间交给音乐。', type: 'preview' }, true); }
  tick() {
    if (this.disposed || this.current < 0) return;
    const deck = this.decks[this.current]; const audio = deck.audio;
    this.emit({ position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    if (!this.running) return;
    if (audio.currentTime !== this.lastPosition) { this.lastPosition = audio.currentTime; this.lastProgressAt = Date.now(); }
    const remaining = audio.duration - audio.currentTime;
    if (Number.isFinite(remaining) && remaining <= this.state.settings.crossfadeSeconds && remaining > 0 && !this.crossfading && !this.advancing) {
      const next = this.decks[1 - this.current];
      if (next.segment?.id === this.queue[0]?.id && next.audio.readyState >= 2) this.advance().catch(e => this.retry(e));
    }
    if (!this.crossfading && !this.preparingNext && !this.advancing && this.queue.length) this.prepareNext();
    if (!this.advancing && Date.now() - (this.lastProgressAt || Date.now()) > 24000 && this.state.status === 'playing') this.failCurrent();
    if (Date.now() - (this.lastSavedAt || 0) > 15000) this.savePosition();
  }
  report(segment, action) { return api('/event', { eventId: uid(), songId: segment.track.id, action, fraction: 0 }).catch(() => {}); }
  recordCurrent(action) {
    const deck = this.decks[this.current]; if (!deck?.segment || deck.recorded) return;
    deck.recorded = true;
    const fraction = Math.min(1, deck.audio.currentTime / (deck.audio.duration || 1));
    api('/event', { eventId: deck.eventId, songId: deck.segment.track.id, action, fraction }).catch(() => {});
  }
  like() { const deck = this.decks[this.current]; if (deck?.segment) { this.report(deck.segment, 'liked'); this.emit({ notice: '已记住：以后多放一点这样的音乐。' }); } }
  failCurrent() { this.recordCurrent('failed'); this.cancelSpeech(); this.advance().catch(e => this.retry(e)); }
  retry(error) {
    if (!this.running || this.disposed) return;
    const delay = Math.min(60, error.retryAfter || 5 * 2 ** Math.min(4, this.failureCount || 0)); this.failureCount = (this.failureCount || 0) + 1;
    this.emit({ status: 'retrying', notice: `${error.message}，${delay} 秒后自动重试。` });
    clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.advance().catch(e => this.retry(e)), delay * 1000);
  }
  savePosition() {
    const deck = this.decks[this.current]; if (!deck?.segment) return;
    this.lastSavedAt = Date.now(); api('/playback', { songId: deck.segment.track.id, position: deck.audio.currentTime }).catch(() => {});
  }
  async pollCommands() {
    if (this.commandAfter == null || this.disposed) return;
    try {
      for (const command of await api('/commands?after=' + this.commandAfter)) {
        this.commandAfter = command.id;
        if (command.action === 'pause') this.pause(); else if (command.action === 'stop') this.stop(); else if (command.action === 'next') this.next();
        else if (!this.unlocked) this.emit({ expanded: true, notice: '点击播放，即可开始 AI 电台。' });
        else this.play(command.action === 'request' ? command.query : '');
      }
    } catch { /* A temporary host restart does not interrupt already-buffered audio. */ }
  }
  setMediaSession() {
    if (!navigator.mediaSession || !window.MediaMetadata || !this.state.track) return;
    const song = this.state.track;
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artists.join(' / '), album: 'Aurora FM · 私人 AI 电台' });
    for (const [key, handler] of Object.entries({ play: () => this.play(), pause: () => this.pause(), nexttrack: () => this.next(), stop: () => this.stop() })) { try { navigator.mediaSession.setActionHandler(key, handler); } catch {} }
  }
  dispose() {
    this.stop(); this.disposed = true; clearInterval(this.timer); clearInterval(this.commandTimer); clearTimeout(this.fadeTimer);
    window.removeEventListener('online', this.online); document.removeEventListener('visibilitychange', this.visibility); this.releaseLock?.(); this.audioContext?.close(); this.listeners.clear();
  }
}
