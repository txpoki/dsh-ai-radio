import { segueCue, PRE_DUCK_SECONDS } from '../lib/timeline.js';
const BASE = '/dsh-ai-radio';
const uid = () => crypto.randomUUID();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function api(path, body, timeout = 45000) {
  const response = await fetch(BASE + path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '电台连接暂时不可用'); error.retryAfter = result.retryAfter; error.status = response.status; throw error; }
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
    this.bedAudio = new Audio(); this.bedAudio.loop = true; this.bedAudio.preload = 'auto'; this.bedAudio.setAttribute('playsinline', '');
    this.needsProgramme = true;
    this.transitionGeneration = 0; this.voiceRevision = 0;
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
    const replan = ['hostId', 'persona', 'city', 'timezone', 'interests', 'extraContext', 'llm', 'humorEvery', 'newsMinutes', 'customFeeds'].some(key => JSON.stringify(previous[key]) !== JSON.stringify(settings[key]));
    if (replan) { this.queue = []; this.needsProgramme = true; }
    if (JSON.stringify(previous.tts) !== JSON.stringify(settings.tts)) { this.voiceRevision++; this.cancelSpeech(); this.speechCache.clear(); this.emit({ voiceStatus: null }); }
    this.emit({ settings, ...(replan ? { queue: [] } : {}) });
    if (this.audioContext) { this.master.gain.setTargetAtTime(settings.volume, this.audioContext.currentTime, 0.1); this.voiceGain.gain.value = settings.speechVolume; }
    if (this.running) this.prepareNext();
    return settings;
  }
  async loadLibrary(ids) {
    this.stop(); const result = await api('/library', { ids }, 180000); await this.refresh();
    this.emit({ notice: `已载入 ${result.count} 首歌曲${result.failures.length ? '，部分歌单读取失败' : ''}` }); return result;
  }
  async startFromPlaylists(ids) {
    this.unlock();
    const same = this.state.librarySource?.type !== 'daily' && JSON.stringify([...ids].sort()) === JSON.stringify([...(this.state.settings.selectedPlaylistIds || [])].sort());
    if (same && (this.programming || this.state.programmeStatus?.status === 'preparing')) {
      this.emit({ expanded: true, page: 'radio' }); return this.play();
    }
    await this.loadLibrary(ids);
    this.emit({ expanded: true, page: 'radio' });
    return this.play();
  }
  async loadDailyRecommendations() {
    this.stop(); const result = await api('/library', { source: 'daily' }, 30000); await this.refresh();
    this.emit({ notice: '已载入今天的 ' + result.count + ' 首网易云每日推荐' }); return result;
  }
  async startFromDaily() {
    this.unlock();
    if (this.state.librarySource?.type === 'daily' && (this.programming || this.state.programmeStatus?.status === 'preparing')) { this.emit({ expanded: true, page: 'radio' }); return this.play(); }
    await this.loadDailyRecommendations(); this.emit({ expanded: true, page: 'radio' }); return this.play();
  }
  async ensureProgramme(query = '') {
    if (this.programming) return this.programming;
    if (!this.needsProgramme && !query) return;
    const generation = this.generation;
    const job = (async () => {
      let status, starting = true, failures = 0;
      while (!this.disposed && generation === this.generation) {
        try {
          status = starting ? await api('/programme/start', { query }, 15000) : await api('/programme', undefined, 12000);
          starting = status.status === 'idle';
          if (failures) this.emit({ notice: '' });
          failures = 0;
        } catch (error) {
          if (this.disposed || generation !== this.generation) return;
          failures++;
          this.emit({ notice: '电台连接暂时中断，正在接回节目进度；已完成的策划会保留。', programmeStatus: { ...this.state.programmeStatus, reconnecting: true } });
          await wait(Math.min(5000, failures * 1000)); continue;
        }
        this.emit({ programmeStatus: { ...status, reconnecting: false } });
        if (status.status === 'ready') { this.needsProgramme = false; return; }
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error || '节目准备已取消');
        await wait(850);
      }
    })().finally(() => { if (this.programming === job) this.programming = null; });
    this.programming = job; return job;
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
    this.bedGain = ctx.createGain(); this.bedGain.gain.value = 0; this.bedGain.connect(this.musicBus);
    ctx.createMediaElementSource(this.bedAudio).connect(this.bedGain);
  }
  unlock() {
    this.graph(); this.audioContext?.resume().catch(() => {});
    if (!this.unlocked) {
      this.unlocked = true;
      // Prime each element inside the original click for browsers that require it.
      const silent = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';
      for (const audio of [...this.decks.map(x => x.audio), this.voiceAudio, this.bedAudio]) { audio.src = silent; audio.play().then(() => { if (!this.running) audio.pause(); }).catch(() => {}); }
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
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (this.current < 0 && !this.programming && this.state.librarySource?.type === 'daily' && this.state.librarySource.date !== today) {
      try { await this.loadDailyRecommendations(); } catch (error) { this.emit({ notice: error.message, expanded: true, page: 'library' }); return; }
    }
    if (!this.state.libraryCount) { this.emit({ expanded: true, page: 'library', notice: '先登录网易云并选择歌单，就可以开台。' }); return; }
    if (!await this.acquire()) { this.emit({ notice: '电台正在另一个标签页播放，请先在那里暂停。' }); return; }
    this.running = true; clearTimeout(this.retryTimer);
    if (this.advancing || this.programming) {
      if (this.state.speech) { this.voiceAudio.play().catch(() => {}); window.speechSynthesis?.resume(); this.bedAudio.play().catch(() => {}); }
      else if (this.programming && this.current < 0) this.bedAudio.play().catch(() => {});
      if (this.current >= 0 && !this.decks[this.current].audio.ended) this.decks[this.current].audio.play().catch(() => {});
      this.emit({ status: this.state.speech ? 'hosting' : this.programming ? 'preparing' : 'playing' }); return;
    }
    if (this.current >= 0 && this.decks[this.current].segment && !query) {
      try {
        await this.decks[this.current].audio.play();
        if (this.state.speech) { if (this.voiceAudio.src && !this.voiceAudio.ended) this.voiceAudio.play().catch(() => {}); window.speechSynthesis?.resume(); }
        this.emit({ status: 'playing', notice: '' }); this.lastProgressAt = Date.now(); this.prepareNext(); return;
      } catch (error) { this.pause(); this.emit({ notice: '请再点击一次播放以启用声音。' }); return; }
    }
    this.emit({ status: 'preparing', notice: '' }); this.nextQuery = query;
    if (query) { this.queue = []; this.needsProgramme = true; }
    const generation = this.generation;
    try {
      if (this.current < 0) await this.startBed();
      await this.ensureProgramme(query);
      if (!this.running || generation !== this.generation) return;
      await this.advance();
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.running = false; this.stopBed(.8); this.releaseLock?.(); this.emit({ status: 'idle', notice: error.message });
    }
  }
  pause() {
    this.running = false; for (const deck of this.decks) deck.audio.pause(); this.voiceAudio.pause(); this.bedAudio.pause(); window.speechSynthesis?.pause();
    clearTimeout(this.retryTimer); clearTimeout(this.transitionTimer); this.savePosition(); this.releaseLock?.(); this.emit({ status: 'paused' });
  }
  stop({ cancelProgramme = true } = {}) {
    if (cancelProgramme && this.programming) api('/programme/cancel', {}).catch(() => {});
    this.pause(); this.generation++; this.cancelSpeech(); this.queue = []; this.current = -1;
    this.transitionGeneration++; clearTimeout(this.transitionTimer);
    this.opening = null; this.needsProgramme = true; this.programming = null; this.stopBed(0);
    clearTimeout(this.fadeTimer); this.crossfading = false;
    for (const deck of this.decks) { deck.segment = null; deck.audio.removeAttribute('src'); deck.audio.load(); }
    this.emit({ status: 'idle', track: null, queue: [], position: 0, duration: 0, speech: null });
  }
  async next() {
    if (!this.running) return this.play();
    if (this.advancing) {
      if (this.transitioning) { this.forceAdvance = true; this.transitionGeneration++; this.recordCurrent('skipped'); this.cancelSpeech(); }
      else { this.skipRequested = true; this.cancelSpeech(); }
      return;
    }
    this.recordCurrent('skipped'); this.cancelSpeech();
    try { await this.advance({ immediate: true }); } catch (error) { this.retry(error); }
  }
  async ensureQueue() {
    if (this.queue.length > 1) return;
    if (this.filling) return this.filling;
    const generation = this.generation;
    const query = this.nextQuery || ''; this.nextQuery = '';
    this.filling = (async () => { await this.ensureProgramme(query); return api('/plan', { requestId: uid(), opening: this.current < 0, query }); })().then(batch => {
      if (this.disposed || generation !== this.generation) return;
      this.queue.push(...batch.segments); if (batch.opening) { this.opening = batch.opening; this.prepareSpeech(batch.opening); }
      this.emit({ queue: [...this.queue], context: batch.context, host: batch.host, batchMode: batch.mode, programmeTitle: batch.programmeTitle, notice: batch.notice || '' });
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
      const pending = api('/speech/prepare', { id: speech.id }, 150000).catch(error => { this.speechCache.delete(key); return { provider: 'unavailable', error: error.message }; });
      pending.then(value => { pending.prepared = value; });
      this.speechCache.set(key, pending);
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
      this.prepareSpeech(segment.speech).then(() => this.armTransition());
      const deck = this.decks[1 - this.current];
      await this.prepareDeck(deck, segment);
    } catch (error) {
      if (segment && generation === this.generation && this.queue[0]?.id === segment.id) { this.report(segment, 'failed'); this.queue.shift(); this.emit({ queue: [...this.queue] }); }
    } finally { this.preparingNext = false; this.armTransition(); }
  }
  cue(segment = this.queue[0]) {
    if (!segment || this.current < 0) return null;
    const prepared = this.speechCache.get(segment.speech?.id + JSON.stringify(this.state.settings.tts))?.prepared;
    return segueCue({ outgoingSeconds: this.decks[this.current].audio.duration, incomingSeconds: segment.track.interval,
      speechSeconds: segment.speech ? prepared?.duration || segment.speech.duration || segment.speech.text.length / (4.2 * this.state.settings.tts.rate) : 0,
      crossfadeSeconds: this.state.settings.crossfadeSeconds });
  }
  armTransition() {
    clearTimeout(this.transitionTimer);
    if (!this.running || this.disposed || this.current < 0 || this.advancing || this.crossfading) return;
    const segment = this.queue[0], deck = this.decks[1 - this.current];
    if (!segment || deck.segment?.id !== segment.id || deck.audio.readyState < 2) return;
    const cue = this.cue(segment), delay = cue.triggerAt - this.decks[this.current].audio.currentTime;
    this.transitionTimer = setTimeout(() => { if (this.running) this.advance().catch(e => this.retry(e)); }, Math.max(0, delay * 1000));
  }
  async waitForCue(audio, target, generation, immediate = true, transition) {
    while (generation === this.generation && !this.disposed && (transition === undefined || transition === this.transitionGeneration)) {
      if (this.running && ((immediate && this.forceAdvance) || audio.ended || audio.currentTime + .025 >= target)) return true;
      await wait(40);
    }
    return false;
  }
  scheduleSpeech(segment, previous, incoming, cue, generation, transition, prepared, musicStarted) {
    const prior = this.transitionSpeech, revision = this.voiceRevision;
    const job = (async () => {
      if (prior) await prior;
      const at = async target => {
        if (target <= cue.musicStart) return this.waitForCue(previous.audio, target, generation, false, transition);
        await musicStarted;
        return this.waitForCue(incoming.audio, Math.max(0, target - cue.musicStart), generation, false, transition);
      };
      const ready = await prepared;
      if (generation !== this.generation || transition !== this.transitionGeneration || revision !== this.voiceRevision) return;
      if (ready.error) { this.emit({ notice: ready.error + '；音乐继续播放。' }); return; }
      if (!await at(cue.duckAt)) return;
      if (revision !== this.voiceRevision) return;
      this.duck(true);
      const duckBegan = Date.now();
      if (!await at(cue.speechStart)) return;
      // Late network delivery still gets an audible pre-duck cue.
      await wait(Math.max(0, PRE_DUCK_SECONDS * 1000 - (Date.now() - duckBegan)));
      if (generation !== this.generation || transition !== this.transitionGeneration || revision !== this.voiceRevision) return;
      await this.say(segment.speech, false, { prepared: ready, preDucked: true });
    })().catch(() => {}).finally(() => { if (this.transitionSpeech === job) this.transitionSpeech = null; });
    this.transitionSpeech = job;
  }
  advance({ immediate = false } = {}) {
    if (this.advancing) return this.advancing;
    clearTimeout(this.transitionTimer);
    if (immediate) { clearTimeout(this.fadeTimer); this.crossfading = false; }
    this.advancing = this._advance(immediate).finally(() => { this.advancing = null; this.transitioning = false; this.forceAdvance = false; if (this.running) this.prepareNext(); }); return this.advancing;
  }
  async _advance(immediate = false) {
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
        const narrated = !previous && !!(this.opening || segment.speech);
        if (narrated) {
          this.cancelSpeech();
          this.emit({ status: 'hosting', upcomingTrack: segment.track });
          await this.startBed();
          if (this.opening) {
            const opening = this.opening; this.opening = null;
            await this.say(opening);
          }
          if (generation !== this.generation) return;
          if (segment.speech && !this.skipRequested) await this.say(segment.speech);
          while (!this.running && generation === this.generation && !this.disposed) await wait(100);
          if (generation !== this.generation) return;
          if (this.skipRequested) {
            this.skipRequested = false; this.report(segment, 'skipped');
            if (this.queue[0]?.id === segment.id) this.queue.shift();
            continue;
          }
        }
        let musicStarted;
        if (previous) {
          this.transitioning = true; this.forceAdvance = immediate;
          const cue = this.cue(segment), transition = ++this.transitionGeneration;
          if (immediate) Object.assign(cue, { musicStart: previous.audio.currentTime, duckAt: previous.audio.currentTime, speechStart: previous.audio.currentTime + PRE_DUCK_SECONDS });
          let started;
          musicStarted = new Promise(resolve => { started = resolve; });
          this.musicStarted = started;
          if (segment.speech) this.scheduleSpeech(segment, previous, deck, cue, generation, transition, this.prepareSpeech(segment.speech), musicStarted);
          if (!await this.waitForCue(previous.audio, cue.musicStart, generation)) { started(); return; }
        }
        if (segment.seekTo && Number.isFinite(deck.audio.duration)) { deck.audio.currentTime = Math.min(segment.seekTo, Math.max(0, deck.audio.duration - 2)); segment.seekTo = 0; }
        if (this.audioContext) { deck.gain.gain.cancelScheduledValues(this.audioContext.currentTime); deck.gain.gain.value = previous && !previous.audio.ended ? 0 : 1; }
        await deck.audio.play();
        this.musicStarted?.(); this.musicStarted = null;
        if (!this.running || generation !== this.generation) { deck.audio.pause(); return; }
        this.recordCurrent('played');
        this.queue.shift(); this.current = deck.index; this.failureCount = 0; this.lastProgressAt = Date.now(); this.lastPosition = 0;
        this.fade(previous, deck, narrated); this.stopBed(1.6);
        this.emit({ track: segment.track, upcomingTrack: null, status: 'playing', queue: [...this.queue], position: 0, duration: deck.audio.duration || segment.track.interval, transitions: this.state.transitions + 1 });
        this.setMediaSession(); this.savePosition();
        return;
      } catch (error) {
        this.musicStarted?.(); this.musicStarted = null; this.transitionGeneration++; this.cancelSpeech();
        if (error.name === 'NotAllowedError') { this.pause(); this.emit({ notice: '浏览器需要你再次点击播放以启用声音。' }); return; }
        this.report(segment, 'failed'); if (this.queue[0]?.id === segment.id) this.queue.shift();
        this.emit({ notice: error.message, queue: [...this.queue] });
      }
    }
    if (this.running) throw new Error('连续多首无法播放，稍后自动重试');
  }
  fade(previous, incoming, narrated = false) {
    clearTimeout(this.fadeTimer);
    if (!previous || previous === incoming || previous.audio.ended || previous.audio.paused || !this.state.settings.crossfadeSeconds) {
      if (previous && previous !== incoming) { previous.audio.pause(); previous.segment = null; }
      if (incoming.gain) {
        const gain = incoming.gain.gain; const now = this.audioContext.currentTime; gain.cancelScheduledValues(now);
        gain.setValueAtTime(narrated ? 0 : 1, now); if (narrated) gain.linearRampToValueAtTime(1, now + 1.4);
      }
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
    if (this.audioContext) {
      const gain = this.musicBus.gain, now = this.audioContext.currentTime;
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
      else { const current = gain.value; gain.cancelScheduledValues(now); gain.setValueAtTime(current, now); }
      gain.setTargetAtTime(value, now, talking ? .22 : .65);
    }
    else { for (const deck of this.decks) deck.audio.volume = value * settings.volume; this.bedAudio.volume = value * settings.volume * settings.bedVolume; }
  }
  async startBed() {
    clearTimeout(this.bedTimer);
    if (!this.bedAudio.src.includes('/bed/audio')) { this.bedAudio.src = BASE + '/bed/audio'; this.bedAudio.load(); }
    if (this.bedGain) {
      const gain = this.bedGain.gain, now = this.audioContext.currentTime;
      gain.cancelScheduledValues(now); gain.setTargetAtTime(this.state.settings.bedVolume, now, 0.2);
    } else this.bedAudio.volume = this.state.settings.bedVolume * this.state.settings.volume;
    await this.bedAudio.play().catch(() => {});
  }
  stopBed(seconds = 0) {
    clearTimeout(this.bedTimer);
    if (this.bedGain) {
      const gain = this.bedGain.gain, now = this.audioContext.currentTime; gain.cancelScheduledValues(now);
      if (seconds) { gain.setValueAtTime(gain.value, now); gain.linearRampToValueAtTime(0, now + seconds); }
      else gain.value = 0;
    }
    if (seconds) this.bedTimer = setTimeout(() => this.bedAudio.pause(), seconds * 1000 + 30);
    else this.bedAudio.pause();
  }
  cancelSpeech() {
    this.voiceGeneration++; this.voiceAudio.pause(); window.speechSynthesis?.cancel(); this.voiceCancel?.(); this.voiceCancel = null;
    this.duck(false); if (this.state.speech) this.emit({ speech: null });
  }
  async say(speech, preview = false, options = {}) {
    const token = ++this.voiceGeneration;
    const cancelled = new Promise(resolve => { this.voiceCancel = () => resolve(null); });
    const prepared = await Promise.race([cancelled, options.prepared || (preview ? api('/speech/prepare', { preview: true }, 150000) : this.prepareSpeech(speech))]);
    if (!prepared) return;
    while (!preview && !this.running && token === this.voiceGeneration && this.state.status === 'paused') await wait(100);
    if (token !== this.voiceGeneration || (!preview && !this.running)) return;
    if (prepared.error) { this.emit({ notice: prepared.error + '；音乐继续播放。' }); return; }
    if (!options.preDucked) {
      this.duck(true); await Promise.race([cancelled, wait(PRE_DUCK_SECONDS * 1000)]);
      while (!preview && !this.running && token === this.voiceGeneration && this.state.status === 'paused') await wait(100);
      if (token !== this.voiceGeneration || (!preview && !this.running)) return;
    }
    this.emit({ speech, voiceStatus: { provider: prepared.provider, voice: prepared.voice || (prepared.provider === 'fish' ? this.state.settings.tts.fishVoiceId : this.state.settings.tts.voice) } });
    if (prepared.notice) this.emit({ notice: prepared.notice });
    let success = false;
    try {
      success = await new Promise(resolve => {
        let timer;
        const done = ok => { clearTimeout(timer); this.voiceAudio.onended = null; this.voiceAudio.onerror = null; this.voiceAudio.onplaying = null; resolve(ok); };
        this.voiceCancel = () => done(false);
        const arm = () => { timer = setTimeout(() => { if (!preview && !this.running) arm(); else done(false); }, 180000); }; arm();
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
  previewVoice() { this.unlock(); this.cancelSpeech(); return this.say({ id: 'preview', text: '听众朋友们，大家好！我是小鲸。今天也攒了好多好听的歌想分享给你。我们的电台，现在开始。', type: 'preview' }, true); }
  tick() {
    if (this.disposed || this.current < 0) return;
    const deck = this.decks[this.current]; const audio = deck.audio;
    this.emit({ position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    if (!this.running) return;
    if (audio.currentTime !== this.lastPosition) { this.lastPosition = audio.currentTime; this.lastProgressAt = Date.now(); }
    if (Date.now() - (this.lastProgressAt || Date.now()) > 24000 && this.state.status === 'playing' && (!this.advancing || this.transitioning)) { this.failCurrent(); return; }
    const remaining = audio.duration - audio.currentTime, cue = this.cue();
    if (cue && Number.isFinite(remaining) && audio.currentTime >= cue.triggerAt && remaining > 0 && !this.crossfading && !this.advancing) {
      const next = this.decks[1 - this.current];
      if (next.segment?.id === this.queue[0]?.id && next.audio.readyState >= 2) this.advance().catch(e => this.retry(e));
    }
    if (!this.crossfading && !this.preparingNext && !this.advancing && this.queue.length) this.prepareNext();
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
  failCurrent() {
    this.recordCurrent('failed'); this.cancelSpeech();
    if (this.transitioning) { this.transitionGeneration++; this.forceAdvance = true; return; }
    this.advance({ immediate: true }).catch(e => this.retry(e));
  }
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
    this.stop({ cancelProgramme: false }); this.disposed = true; clearInterval(this.timer); clearInterval(this.commandTimer); clearTimeout(this.fadeTimer); clearTimeout(this.bedTimer); clearTimeout(this.transitionTimer);
    window.removeEventListener('online', this.online); document.removeEventListener('visibilitychange', this.visibility); this.releaseLock?.(); this.audioContext?.close(); this.listeners.clear();
  }
}
