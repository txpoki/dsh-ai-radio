/* Generated from client/. Run pnpm build after edits. */
window.__ModuleLoader__.load({id:'dsh-ai-radio',factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react2 = __toESM(require("react"), 1);

// client/app.jsx
var import_react = __toESM(require("react"), 1);

// client/engine.js
var BASE = "/dsh-ai-radio";
var uid = () => crypto.randomUUID();
var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, body, timeout = 45e3) {
  const response = await fetch(BASE + path, { ...body === void 0 ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "\u7535\u53F0\u8FDE\u63A5\u6682\u65F6\u4E0D\u53EF\u7528");
    error.retryAfter = result.retryAfter;
    throw error;
  }
  return result;
}
function equalPower(size = 64) {
  return { incoming: Float32Array.from({ length: size }, (_, i) => Math.sin(i / (size - 1) * Math.PI / 2)), outgoing: Float32Array.from({ length: size }, (_, i) => Math.cos(i / (size - 1) * Math.PI / 2)) };
}
var RadioController = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Set();
    this.queue = [];
    this.current = -1;
    this.running = false;
    this.generation = 0;
    this.voiceGeneration = 0;
    this.disposed = false;
    this.state = { loading: true, status: "idle", expanded: false, page: "radio", track: null, speech: null, position: 0, duration: 0, queue: [], notice: "", context: null, batchMode: "", settings: null, history: [], spokenCount: 0, transitions: 0 };
    this.decks = [0, 1].map((index) => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.setAttribute("playsinline", "");
      const deck = { audio, index, segment: null, eventId: "", recorded: false };
      audio.addEventListener("ended", () => {
        if (this.current === index && this.running) this.advance().catch((e) => this.retry(e));
      });
      audio.addEventListener("timeupdate", () => this.tick());
      audio.addEventListener("error", () => {
        if (this.current === index && deck.segment && this.running && !this.advancing) this.failCurrent();
      });
      return deck;
    });
    this.voiceAudio = new Audio();
    this.voiceAudio.setAttribute("playsinline", "");
    this.speechCache = /* @__PURE__ */ new Map();
    this.timer = setInterval(() => this.tick(), 1e3);
    this.commandTimer = setInterval(() => this.pollCommands(), 2e3);
    this.online = () => {
      if (this.running && this.state.status === "retrying") {
        clearTimeout(this.retryTimer);
        this.advance().catch((e) => this.retry(e));
      }
    };
    window.addEventListener("online", this.online);
    this.visibility = () => {
      if (this.audioContext?.state === "suspended" && this.running) this.audioContext.resume().catch(() => {
      });
    };
    document.addEventListener("visibilitychange", this.visibility);
  }
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.state;
  emit(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async init() {
    try {
      const data = await api("/bootstrap");
      this.commandAfter = data.commandSequence;
      this.emit({ ...data, loading: false, status: "idle" });
      this.models = await api("/models").catch(() => []);
      const updated = this.models.length ? await api("/bootstrap") : {};
      this.emit({ ...updated, models: this.models });
      api("/context").then((context) => !this.disposed && this.emit({ context })).catch(() => {
      });
    } catch (error) {
      this.emit({ loading: false, notice: error.message });
    }
  }
  async refresh() {
    const data = await api("/bootstrap");
    this.emit({ ...data });
    return data;
  }
  async saveSettings(patch) {
    const previous = this.state.settings;
    const settings = await api("/settings", patch);
    const replan = ["hostId", "city", "timezone", "interests", "extraContext", "llm", "speechEvery", "humorEvery", "newsMinutes"].some((key) => JSON.stringify(previous[key]) !== JSON.stringify(settings[key]));
    if (replan) {
      this.generation++;
      this.queue = [];
    }
    if (JSON.stringify(previous.tts) !== JSON.stringify(settings.tts)) this.speechCache.clear();
    this.emit({ settings, ...replan ? { queue: [] } : {} });
    if (this.audioContext) {
      this.master.gain.setTargetAtTime(settings.volume, this.audioContext.currentTime, 0.1);
      this.voiceGain.gain.value = settings.speechVolume;
    }
    if (this.running) this.prepareNext();
    return settings;
  }
  async loadLibrary(ids) {
    this.stop();
    const result = await api("/library", { ids }, 18e4);
    await this.refresh();
    this.emit({ notice: `\u5DF2\u8F7D\u5165 ${result.count} \u9996\u6B4C\u66F2${result.failures.length ? "\uFF0C\u90E8\u5206\u6B4C\u5355\u8BFB\u53D6\u5931\u8D25" : ""}` });
    return result;
  }
  graph() {
    if (this.audioContext) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.audioContext = new Context();
    const ctx = this.audioContext;
    this.master = ctx.createGain();
    this.master.gain.value = this.state.settings?.volume ?? 0.75;
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = this.state.settings?.speechVolume ?? 1;
    this.voiceGain.connect(this.master);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    for (const deck of this.decks) {
      deck.gain = ctx.createGain();
      deck.gain.gain.value = 0;
      ctx.createMediaElementSource(deck.audio).connect(deck.gain);
      deck.gain.connect(this.musicBus);
    }
    ctx.createMediaElementSource(this.voiceAudio).connect(this.voiceGain);
  }
  unlock() {
    this.graph();
    this.audioContext?.resume().catch(() => {
    });
    if (!this.unlocked) {
      this.unlocked = true;
      const silent = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";
      for (const audio of [...this.decks.map((x) => x.audio), this.voiceAudio]) {
        audio.src = silent;
        audio.play().then(() => {
          if (!this.running) audio.pause();
        }).catch(() => {
        });
      }
    }
  }
  async acquire() {
    if (this.releaseLock) return true;
    if (!navigator.locks) return true;
    return new Promise((resolve) => {
      navigator.locks.request("dsh-ai-radio-audio-owner", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        await new Promise((release) => {
          this.releaseLock = () => {
            release();
            this.releaseLock = null;
          };
          resolve(true);
        });
      }).catch(() => resolve(false));
    });
  }
  async play(query = "") {
    this.unlock();
    if (!this.state.settings) return;
    if (!this.state.libraryCount) {
      this.emit({ expanded: true, page: "library", notice: "\u5148\u767B\u5F55\u7F51\u6613\u4E91\u5E76\u9009\u62E9\u6B4C\u5355\uFF0C\u5C31\u53EF\u4EE5\u5F00\u53F0\u3002" });
      return;
    }
    if (!await this.acquire()) {
      this.emit({ notice: "\u7535\u53F0\u6B63\u5728\u53E6\u4E00\u4E2A\u6807\u7B7E\u9875\u64AD\u653E\uFF0C\u8BF7\u5148\u5728\u90A3\u91CC\u6682\u505C\u3002" });
      return;
    }
    this.running = true;
    clearTimeout(this.retryTimer);
    if (this.current >= 0 && this.decks[this.current].segment && !query) {
      try {
        await this.decks[this.current].audio.play();
        if (this.state.speech) {
          if (this.voiceAudio.src && !this.voiceAudio.ended) this.voiceAudio.play().catch(() => {
          });
          window.speechSynthesis?.resume();
        }
        this.emit({ status: "playing", notice: "" });
        this.lastProgressAt = Date.now();
        this.prepareNext();
        return;
      } catch (error) {
        this.pause();
        this.emit({ notice: "\u8BF7\u518D\u70B9\u51FB\u4E00\u6B21\u64AD\u653E\u4EE5\u542F\u7528\u58F0\u97F3\u3002" });
        return;
      }
    }
    this.emit({ status: "preparing", notice: "" });
    this.nextQuery = query;
    if (query) {
      this.queue = [];
      this.generation++;
    }
    if (!query && this.current < 0 && !this.queue.length && this.state.resumeTrack && this.state.playback?.position > 2) {
      this.queue.push({ id: uid(), track: this.state.resumeTrack, speech: null, seekTo: this.state.playback.position });
      this.emit({ resumeTrack: null });
    }
    try {
      await this.advance();
    } catch (error) {
      this.retry(error);
    }
  }
  pause() {
    this.running = false;
    for (const deck of this.decks) deck.audio.pause();
    this.voiceAudio.pause();
    window.speechSynthesis?.pause();
    clearTimeout(this.retryTimer);
    this.savePosition();
    this.releaseLock?.();
    this.emit({ status: "paused" });
  }
  stop() {
    this.pause();
    this.generation++;
    this.cancelSpeech();
    this.queue = [];
    this.current = -1;
    clearTimeout(this.fadeTimer);
    this.crossfading = false;
    for (const deck of this.decks) {
      deck.segment = null;
      deck.audio.removeAttribute("src");
      deck.audio.load();
    }
    this.emit({ status: "idle", track: null, queue: [], position: 0, duration: 0, speech: null });
  }
  async next() {
    if (!this.running) return this.play();
    this.recordCurrent("skipped");
    this.cancelSpeech();
    try {
      await this.advance();
    } catch (error) {
      this.retry(error);
    }
  }
  async ensureQueue() {
    if (this.queue.length > 1) return;
    if (this.filling) return this.filling;
    const generation = this.generation;
    const query = this.nextQuery || "";
    this.nextQuery = "";
    this.filling = api("/plan", { requestId: uid(), opening: this.current < 0, query }).then((batch) => {
      if (this.disposed || generation !== this.generation) return;
      this.queue.push(...batch.segments);
      this.emit({ queue: [...this.queue], context: batch.context, host: batch.host, batchMode: batch.mode, notice: batch.notice || "" });
    }).finally(() => {
      this.filling = null;
    });
    return this.filling;
  }
  async prepareDeck(deck, segment) {
    if (deck.segment?.id === segment.id && deck.audio.readyState >= 1) return;
    deck.audio.pause();
    deck.segment = null;
    const audio = deck.audio;
    await new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", ready);
        audio.removeEventListener("error", fail);
      };
      const ready = () => {
        clean();
        resolve();
      };
      const fail = () => {
        clean();
        reject(new Error("\u8FD9\u9996\u6B4C\u7684\u97F3\u9891\u6682\u65F6\u4E0D\u53EF\u7528"));
      };
      const timer = setTimeout(fail, 14e3);
      audio.addEventListener("loadedmetadata", ready);
      audio.addEventListener("error", fail);
      audio.src = `${BASE}/track/${encodeURIComponent(segment.track.id)}/audio?play=${encodeURIComponent(segment.id)}`;
      audio.load();
    });
    deck.segment = segment;
    deck.eventId = uid();
    deck.recorded = false;
  }
  prepareSpeech(speech) {
    if (!speech) return Promise.resolve(null);
    const key = speech.id + JSON.stringify(this.state.settings.tts);
    if (!this.speechCache.has(key)) {
      this.speechCache.set(key, api("/speech/prepare", { id: speech.id }, 18e3).catch((error) => ({ provider: "browser", text: speech.text, ...this.state.settings.tts, error: error.message, fallback: true })));
      if (this.speechCache.size > 30) this.speechCache.delete(this.speechCache.keys().next().value);
    }
    return this.speechCache.get(key);
  }
  async prepareNext() {
    if (!this.running || this.preparingNext || this.crossfading) return;
    const generation = this.generation;
    this.preparingNext = true;
    let segment;
    try {
      await this.ensureQueue();
      segment = this.queue[0];
      if (!segment || generation !== this.generation || !this.running || this.current < 0) return;
      this.prepareSpeech(segment.speech);
      const deck = this.decks[1 - this.current];
      await this.prepareDeck(deck, segment);
    } catch (error) {
      if (segment && generation === this.generation && this.queue[0]?.id === segment.id) {
        this.report(segment, "failed");
        this.queue.shift();
        this.emit({ queue: [...this.queue] });
      }
    } finally {
      this.preparingNext = false;
    }
  }
  advance() {
    if (this.advancing) return this.advancing;
    this.advancing = this._advance().finally(() => {
      this.advancing = null;
      if (this.running) this.prepareNext();
    });
    return this.advancing;
  }
  async _advance() {
    const generation = this.generation;
    for (let attempts = 0; attempts < 8 && this.running; attempts++) {
      if (!this.queue.length) {
        await this.ensureQueue();
        if (generation !== this.generation) return;
      }
      if (!this.queue.length) throw new Error("\u6B63\u5728\u51C6\u5907\u4E0B\u4E00\u6BB5\u8282\u76EE");
      const segment = this.queue[0];
      const previous = this.current < 0 ? null : this.decks[this.current];
      const deck = this.decks[this.current < 0 ? 0 : 1 - this.current];
      try {
        if (this.preparingNext) {
          for (let i = 0; i < 150 && this.preparingNext; i++) await wait(100);
        }
        await this.prepareDeck(deck, segment);
        if (!this.running || generation !== this.generation) return;
        if (segment.seekTo && Number.isFinite(deck.audio.duration)) {
          deck.audio.currentTime = Math.min(segment.seekTo, Math.max(0, deck.audio.duration - 2));
          segment.seekTo = 0;
        }
        if (this.audioContext) {
          deck.gain.gain.cancelScheduledValues(this.audioContext.currentTime);
          deck.gain.gain.value = previous && !previous.audio.ended ? 0 : 1;
        }
        await deck.audio.play();
        if (!this.running || generation !== this.generation) {
          deck.audio.pause();
          return;
        }
        this.recordCurrent("played");
        this.cancelSpeech();
        this.queue.shift();
        this.current = deck.index;
        this.failureCount = 0;
        this.lastProgressAt = Date.now();
        this.lastPosition = 0;
        this.fade(previous, deck);
        this.emit({ track: segment.track, status: "playing", queue: [...this.queue], position: 0, duration: deck.audio.duration || segment.track.interval, transitions: this.state.transitions + 1 });
        this.setMediaSession();
        this.savePosition();
        if (segment.speech) this.say(segment.speech).catch(() => {
        });
        return;
      } catch (error) {
        if (error.name === "NotAllowedError") {
          this.pause();
          this.emit({ notice: "\u6D4F\u89C8\u5668\u9700\u8981\u4F60\u518D\u6B21\u70B9\u51FB\u64AD\u653E\u4EE5\u542F\u7528\u58F0\u97F3\u3002" });
          return;
        }
        this.report(segment, "failed");
        if (this.queue[0]?.id === segment.id) this.queue.shift();
        this.emit({ notice: error.message, queue: [...this.queue] });
      }
    }
    if (this.running) throw new Error("\u8FDE\u7EED\u591A\u9996\u65E0\u6CD5\u64AD\u653E\uFF0C\u7A0D\u540E\u81EA\u52A8\u91CD\u8BD5");
  }
  fade(previous, incoming) {
    clearTimeout(this.fadeTimer);
    if (!previous || previous === incoming || previous.audio.ended || !this.state.settings.crossfadeSeconds) {
      if (previous && previous !== incoming) {
        previous.audio.pause();
        previous.segment = null;
      }
      if (incoming.gain) incoming.gain.gain.value = 1;
      return;
    }
    const seconds = Math.min(this.state.settings.crossfadeSeconds, Math.max(0.1, previous.audio.duration - previous.audio.currentTime), Math.max(0.1, incoming.audio.duration / 2));
    this.crossfading = true;
    if (this.audioContext) {
      const now = this.audioContext.currentTime;
      const curves = equalPower();
      for (const deck of [previous, incoming]) deck.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueCurveAtTime(curves.outgoing, now, seconds);
      incoming.gain.gain.setValueCurveAtTime(curves.incoming, now, seconds);
    } else {
      previous.audio.volume = 0.15;
      incoming.audio.volume = this.state.settings.volume;
    }
    this.fadeTimer = setTimeout(() => {
      previous.audio.pause();
      previous.segment = null;
      this.crossfading = false;
      this.prepareNext();
    }, seconds * 1e3 + 50);
  }
  duck(talking) {
    const settings = this.state.settings || { duckVolume: 0.18, volume: 0.75 };
    const value = talking ? settings.duckVolume : 1;
    if (this.audioContext) {
      const gain = this.musicBus.gain;
      gain.cancelScheduledValues(this.audioContext.currentTime);
      gain.setTargetAtTime(value, this.audioContext.currentTime, talking ? 0.18 : 0.6);
    } else for (const deck of this.decks) deck.audio.volume = value * settings.volume;
  }
  cancelSpeech() {
    this.voiceGeneration++;
    this.voiceAudio.pause();
    window.speechSynthesis?.cancel();
    this.voiceCancel?.();
    this.voiceCancel = null;
    this.duck(false);
    if (this.state.speech) this.emit({ speech: null });
  }
  async say(speech, preview = false) {
    const token = ++this.voiceGeneration;
    const prepared = preview ? await api("/speech/prepare", { preview: true }) : await this.prepareSpeech(speech);
    if (token !== this.voiceGeneration || !preview && !this.running) return;
    this.duck(true);
    this.emit({ speech });
    if (prepared.error) this.emit({ notice: prepared.error + "\uFF1B\u672C\u6BB5\u6539\u7528\u7CFB\u7EDF\u97F3\u8272\u3002" });
    let success = false;
    try {
      success = await new Promise((resolve) => {
        let timer;
        const done = (ok) => {
          clearTimeout(timer);
          this.voiceAudio.onended = null;
          this.voiceAudio.onerror = null;
          resolve(ok);
        };
        this.voiceCancel = () => done(false);
        const arm = () => {
          timer = setTimeout(() => {
            if (!preview && !this.running) arm();
            else done(false);
          }, 9e4);
        };
        arm();
        if (prepared.url) {
          this.voiceAudio.src = prepared.url;
          this.voiceAudio.onended = () => done(true);
          this.voiceAudio.onerror = () => done(false);
          this.voiceAudio.play().catch(() => done(false));
        } else {
          if (!window.speechSynthesis) {
            done(false);
            return;
          }
          const utterance = new SpeechSynthesisUtterance(speech.text);
          const voices = window.speechSynthesis.getVoices();
          const cfg = this.state.settings.tts;
          utterance.voice = voices.find((v) => v.voiceURI === cfg.voice || v.name === cfg.voice) || voices.find((v) => v.lang.startsWith("zh")) || null;
          utterance.lang = cfg.language || "zh-CN";
          utterance.rate = cfg.rate || 1;
          utterance.volume = this.state.settings.speechVolume * this.state.settings.volume;
          utterance.onend = () => done(true);
          utterance.onerror = () => done(false);
          window.speechSynthesis.speak(utterance);
        }
      });
    } finally {
      if (token === this.voiceGeneration) {
        this.duck(false);
        this.emit({ speech: null, spokenCount: this.state.spokenCount + (success ? 1 : 0) });
      }
    }
    if (success && !preview) api("/speech/heard", { id: speech.id }).catch(() => {
    });
    if (!success && token === this.voiceGeneration && this.running) this.emit({ notice: "\u8FD9\u6BB5\u53E3\u64AD\u6682\u65F6\u65E0\u6CD5\u64AD\u653E\uFF0C\u97F3\u4E50\u7EE7\u7EED\u3002\u53EF\u5728\u8BBE\u7F6E\u4E2D\u5207\u6362\u97F3\u8272\u670D\u52A1\u3002" });
  }
  previewVoice() {
    this.unlock();
    this.cancelSpeech();
    return this.say({ id: "preview", text: "\u4F60\u597D\uFF0C\u8FD9\u91CC\u662F\u4F60\u7684\u79C1\u4EBA\u97F3\u4E50\u7535\u53F0\u3002\u63A5\u4E0B\u6765\uFF0C\u628A\u65F6\u95F4\u4EA4\u7ED9\u97F3\u4E50\u3002", type: "preview" }, true);
  }
  tick() {
    if (this.disposed || this.current < 0) return;
    const deck = this.decks[this.current];
    const audio = deck.audio;
    this.emit({ position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    if (!this.running) return;
    if (audio.currentTime !== this.lastPosition) {
      this.lastPosition = audio.currentTime;
      this.lastProgressAt = Date.now();
    }
    const remaining = audio.duration - audio.currentTime;
    if (Number.isFinite(remaining) && remaining <= this.state.settings.crossfadeSeconds && remaining > 0 && !this.crossfading && !this.advancing) {
      const next = this.decks[1 - this.current];
      if (next.segment?.id === this.queue[0]?.id && next.audio.readyState >= 2) this.advance().catch((e) => this.retry(e));
    }
    if (!this.crossfading && !this.preparingNext && !this.advancing && this.queue.length) this.prepareNext();
    if (!this.advancing && Date.now() - (this.lastProgressAt || Date.now()) > 24e3 && this.state.status === "playing") this.failCurrent();
    if (Date.now() - (this.lastSavedAt || 0) > 15e3) this.savePosition();
  }
  report(segment, action) {
    return api("/event", { eventId: uid(), songId: segment.track.id, action, fraction: 0 }).catch(() => {
    });
  }
  recordCurrent(action) {
    const deck = this.decks[this.current];
    if (!deck?.segment || deck.recorded) return;
    deck.recorded = true;
    const fraction = Math.min(1, deck.audio.currentTime / (deck.audio.duration || 1));
    api("/event", { eventId: deck.eventId, songId: deck.segment.track.id, action, fraction }).catch(() => {
    });
  }
  like() {
    const deck = this.decks[this.current];
    if (deck?.segment) {
      this.report(deck.segment, "liked");
      this.emit({ notice: "\u5DF2\u8BB0\u4F4F\uFF1A\u4EE5\u540E\u591A\u653E\u4E00\u70B9\u8FD9\u6837\u7684\u97F3\u4E50\u3002" });
    }
  }
  failCurrent() {
    this.recordCurrent("failed");
    this.cancelSpeech();
    this.advance().catch((e) => this.retry(e));
  }
  retry(error) {
    if (!this.running || this.disposed) return;
    const delay = Math.min(60, error.retryAfter || 5 * 2 ** Math.min(4, this.failureCount || 0));
    this.failureCount = (this.failureCount || 0) + 1;
    this.emit({ status: "retrying", notice: `${error.message}\uFF0C${delay} \u79D2\u540E\u81EA\u52A8\u91CD\u8BD5\u3002` });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.advance().catch((e) => this.retry(e)), delay * 1e3);
  }
  savePosition() {
    const deck = this.decks[this.current];
    if (!deck?.segment) return;
    this.lastSavedAt = Date.now();
    api("/playback", { songId: deck.segment.track.id, position: deck.audio.currentTime }).catch(() => {
    });
  }
  async pollCommands() {
    if (this.commandAfter == null || this.disposed) return;
    try {
      for (const command of await api("/commands?after=" + this.commandAfter)) {
        this.commandAfter = command.id;
        if (command.action === "pause") this.pause();
        else if (command.action === "stop") this.stop();
        else if (command.action === "next") this.next();
        else if (!this.unlocked) this.emit({ expanded: true, notice: "\u70B9\u51FB\u64AD\u653E\uFF0C\u5373\u53EF\u5F00\u59CB AI \u7535\u53F0\u3002" });
        else this.play(command.action === "request" ? command.query : "");
      }
    } catch {
    }
  }
  setMediaSession() {
    if (!navigator.mediaSession || !window.MediaMetadata || !this.state.track) return;
    const song = this.state.track;
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artists.join(" / "), album: "Aurora FM \xB7 \u79C1\u4EBA AI \u7535\u53F0" });
    for (const [key, handler] of Object.entries({ play: () => this.play(), pause: () => this.pause(), nexttrack: () => this.next(), stop: () => this.stop() })) {
      try {
        navigator.mediaSession.setActionHandler(key, handler);
      } catch {
      }
    }
  }
  dispose() {
    this.stop();
    this.disposed = true;
    clearInterval(this.timer);
    clearInterval(this.commandTimer);
    clearTimeout(this.fadeTimer);
    window.removeEventListener("online", this.online);
    document.removeEventListener("visibilitychange", this.visibility);
    this.releaseLock?.();
    this.audioContext?.close();
    this.listeners.clear();
  }
};

// client/app.jsx
var STATUS = { idle: "\u4E3A\u6B64\u523B\uFF0C\u8C03\u4E00\u4E2A\u9891\u7387", preparing: "\u6B63\u5728\u51C6\u5907\u4F60\u7684\u8282\u76EE", playing: "\u6B63\u5728\u64AD\u51FA", paused: "\u7535\u53F0\u5DF2\u6682\u505C", retrying: "\u6B63\u5728\u91CD\u65B0\u8FDE\u63A5" };
var time = (value) => `${Math.floor((value || 0) / 60)}:${String(Math.floor((value || 0) % 60)).padStart(2, "0")}`;
function Icon({ name, size = 20, ...props }) {
  const paths = { play: /* @__PURE__ */ import_react.default.createElement("path", { d: "m9 5 11 7-11 7Z", fill: "currentColor", stroke: "none" }), pause: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("path", { d: "M8 5v14M16 5v14", strokeWidth: "4" })), next: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("path", { d: "m5 5 10 7-10 7Z", fill: "currentColor", stroke: "none" }), /* @__PURE__ */ import_react.default.createElement("path", { d: "M19 5v14", strokeWidth: "3" })), radio: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("rect", { x: "3", y: "8", width: "18", height: "13", rx: "3" }), /* @__PURE__ */ import_react.default.createElement("path", { d: "m5 8 13-5M6 13h3m-3 4h3" }), /* @__PURE__ */ import_react.default.createElement("circle", { cx: "16", cy: "15", r: "3" })), settings: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("path", { d: "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" }), /* @__PURE__ */ import_react.default.createElement("circle", { cx: "12", cy: "12", r: "5" })), heart: /* @__PURE__ */ import_react.default.createElement("path", { d: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" }), close: /* @__PURE__ */ import_react.default.createElement("path", { d: "m6 6 12 12M6 18 18 6" }), list: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("path", { d: "M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" })), news: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("rect", { x: "4", y: "3", width: "16", height: "18", rx: "2" }), /* @__PURE__ */ import_react.default.createElement("path", { d: "M8 7h8M8 11h8M8 15h4M8 18h8" })), history: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("path", { d: "M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" })), arrow: /* @__PURE__ */ import_react.default.createElement("path", { d: "M5 12h14m-5-5 5 5-5 5" }), weather: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("circle", { cx: "12", cy: "12", r: "4" }), /* @__PURE__ */ import_react.default.createElement("path", { d: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" })), volume: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("path", { d: "m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" })), refresh: /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("path", { d: "M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" })) };
  return /* @__PURE__ */ import_react.default.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", ...props }, paths[name] || paths.radio);
}
function Spectrum({ controller, playing }) {
  const ref = (0, import_react.useRef)();
  (0, import_react.useEffect)(() => {
    let frame;
    const draw = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const data = new Uint8Array(64);
      if (playing && controller.analyser) controller.analyser.getByteFrequencyData(data);
      const bars = 34, gap = 4, bw = (w - gap * bars) / bars;
      for (let i = 0; i < bars; i++) {
        const value = Math.max(2, data[i] / 255 * h * 0.9);
        ctx.fillStyle = `rgba(195,231,170,${0.3 + data[i] / 400})`;
        ctx.fillRect(i * (bw + gap), (h - value) / 2, bw, value);
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [controller, playing]);
  return /* @__PURE__ */ import_react.default.createElement("canvas", { className: "ar-spectrum", ref, width: "510", height: "64", "aria-label": "\u5B9E\u65F6\u97F3\u9891\u9891\u8C31" });
}
function Button({ children, icon, className = "", ...props }) {
  return /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-button " + className, ...props }, icon && /* @__PURE__ */ import_react.default.createElement(Icon, { name: icon }), " ", children);
}
function Cover({ title, large = false }) {
  const seed = [...String(title || "AURORA")].reduce((a, c) => a + c.charCodeAt(0), 0);
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-cover " + (large ? "large" : ""), style: { "--cover-hue": `${seed % 70 + 120}deg` } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-cover-orbit" }), /* @__PURE__ */ import_react.default.createElement("span", null, title ? [...title].slice(0, 4).join("") : "AURORA"), /* @__PURE__ */ import_react.default.createElement("small", null, "PERSONAL FREQUENCY"));
}
function App({ controller, standalone = false, miniOnly = false, panelOnly = false }) {
  const s = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.snapshot);
  const [clock, setClock] = (0, import_react.useState)(/* @__PURE__ */ new Date());
  (0, import_react.useEffect)(() => {
    const timer = setInterval(() => setClock(/* @__PURE__ */ new Date()), 1e3);
    return () => clearInterval(timer);
  }, []);
  const open = (page) => controller.emit({ expanded: true, page });
  if (s.loading) return /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-root" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-loading" }, "\u6B63\u5728\u8C03\u9891\u2026"));
  if (!s.settings) return /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-root" }, /* @__PURE__ */ import_react.default.createElement(Button, { onClick: () => controller.init() }, "\u91CD\u65B0\u8FDE\u63A5\u7535\u53F0"), /* @__PURE__ */ import_react.default.createElement("p", null, s.notice));
  const shown = !miniOnly && (standalone || s.expanded);
  const active = s.status === "playing";
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-root " + (standalone ? "ar-standalone" : "") }, !standalone && !panelOnly && /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-mini" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-mini-brand", onClick: () => open("radio") }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "radio" }), " ", /* @__PURE__ */ import_react.default.createElement("span", null, "Aurora ", /* @__PURE__ */ import_react.default.createElement("b", null, "FM"))), /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-mini-title" }, s.track ? `${s.track.title} \xB7 ${s.track.artists.join(" / ")}` : "\u4F60\u7684\u79C1\u4EBA AI \u7535\u53F0"), /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-icon-button", "aria-label": active ? "\u6682\u505C\u7535\u53F0" : "\u64AD\u653E\u7535\u53F0", onClick: () => active ? controller.pause() : controller.play() }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: active ? "pause" : "play" })), /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-icon-button", "aria-label": "\u6253\u5F00\u7535\u53F0\u8BBE\u7F6E", onClick: () => open("settings") }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "settings" }))), shown && /* @__PURE__ */ import_react.default.createElement("div", { className: standalone ? "ar-app" : "ar-backdrop", onClick: (event) => {
    if (event.target === event.currentTarget && !standalone) controller.emit({ expanded: false });
  } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-window" }, /* @__PURE__ */ import_react.default.createElement("aside", { className: "ar-sidebar" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-brand", onClick: () => open("radio") }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-brand-icon" }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "radio", size: 25 })), /* @__PURE__ */ import_react.default.createElement("span", null, "Aurora ", /* @__PURE__ */ import_react.default.createElement("b", null, "FM"), /* @__PURE__ */ import_react.default.createElement("small", null, "PRIVATE AI RADIO"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-nav-label" }, "\u4F60\u7684\u6536\u542C\u7A7A\u95F4"), /* @__PURE__ */ import_react.default.createElement("nav", null, [["radio", "radio", "\u6B63\u5728\u6536\u542C"], ["library", "list", "\u6211\u7684\u6B4C\u5355"], ["news", "news", "\u4ECA\u65E5\u8D44\u8BAF"], ["history", "history", "\u6536\u542C\u8DB3\u8FF9"]].map(([page, icon, label]) => /* @__PURE__ */ import_react.default.createElement("button", { key: page, className: s.page === page ? "selected" : "", onClick: () => open(page) }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: icon }), label, page === "radio" && active && /* @__PURE__ */ import_react.default.createElement("i", { className: "ar-live-dot" })))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-sidebar-bottom" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-sidebar-note" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-tiny-star" }, "\u2726"), " \u4E3A\u4F60\u9009\u6B4C\uFF0C\u4E5F\u966A\u4F60\u804A\u804A\u3002", /* @__PURE__ */ import_react.default.createElement("small", null, "\u97F3\u4E50 \xB7 \u5929\u6C14 \xB7 \u6B64\u523B\u7684\u4E16\u754C")), /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-settings-nav " + (s.page === "settings" ? "selected" : ""), onClick: () => open("settings") }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "settings" }), " \u7535\u53F0\u8BBE\u7F6E"), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-account" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-avatar" }, s.account?.nickname?.slice(0, 1) || "\u4F60"), /* @__PURE__ */ import_react.default.createElement("span", null, s.account?.nickname || "\u8FD8\u672A\u8FDE\u63A5\u7F51\u6613\u4E91", /* @__PURE__ */ import_react.default.createElement("small", null, s.demo ? "\u6F14\u793A\u6A21\u5F0F \xB7 \u5408\u6210\u97F3\u9891" : s.account ? "\u7F51\u6613\u4E91\u97F3\u4E50\u5DF2\u8FDE\u63A5" : "\u8FDE\u63A5\u4F60\u7684\u97F3\u4E50\u4E16\u754C"))))), /* @__PURE__ */ import_react.default.createElement("main", { className: "ar-main" }, /* @__PURE__ */ import_react.default.createElement("header", { className: "ar-topbar" }, /* @__PURE__ */ import_react.default.createElement("span", null, /* @__PURE__ */ import_react.default.createElement("i", { className: "ar-live-dot " + (!active ? "off" : "") }), s.speech ? "\u4E3B\u64AD\u6B63\u5728\u8BF4\u8BDD" : STATUS[s.status], s.demo && /* @__PURE__ */ import_react.default.createElement("b", { className: "ar-demo-badge" }, "\u6F14\u793A")), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("time", null, clock.toLocaleTimeString("zh-CN", { timeZone: s.settings.timezone, hour: "2-digit", minute: "2-digit" })), /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-top-divider" }), s.context?.weather ? /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-weather" }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "weather", size: 17 }), s.context.weather.city, " ", s.context.weather.temperature, "\xB0") : /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-weather" }, s.settings.city), !standalone && /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-icon-button", "aria-label": "\u6536\u8D77\u7535\u53F0", onClick: () => controller.emit({ expanded: false }) }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "close" })))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-content" }, s.page === "radio" && /* @__PURE__ */ import_react.default.createElement(RadioPage, { controller, state: s }), s.page === "library" && /* @__PURE__ */ import_react.default.createElement(LibraryPage, { controller, state: s }), s.page === "settings" && /* @__PURE__ */ import_react.default.createElement(SettingsPage, { controller, state: s }), s.page === "news" && /* @__PURE__ */ import_react.default.createElement(NewsPage, { controller, state: s }), s.page === "history" && /* @__PURE__ */ import_react.default.createElement(HistoryPage, { controller, state: s })), s.notice && /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-notice", role: "status" }, /* @__PURE__ */ import_react.default.createElement("span", null, s.notice), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED\u63D0\u793A", onClick: () => controller.emit({ notice: "" }) }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("footer", { className: "ar-footer" }, /* @__PURE__ */ import_react.default.createElement("span", null, /* @__PURE__ */ import_react.default.createElement("i", { className: "ar-live-dot" }), s.batchMode === "ai" ? "AI \u4E3B\u6301\u5DF2\u5C31\u7EEA" : s.batchMode === "continuity" ? "\u8FDE\u7EED\u64AD\u653E \xB7 \u57FA\u7840\u4E32\u573A" : "\u4E3A\u6B64\u523B\u7559\u4E00\u70B9\u97F3\u4E50"), /* @__PURE__ */ import_react.default.createElement("span", null, s.libraryCount, " \u9996\u6B4C \xB7 ", s.settings.crossfadeSeconds, " \u79D2\u6E10\u53D8\u8854\u63A5"))))));
}
function RadioPage({ controller, state: s }) {
  const active = s.status === "playing";
  const busy = s.status === "preparing";
  const host = s.host || s.hosts.find((h) => h.id === s.settings.hostId);
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-eyebrow" }, "A LITTLE MUSIC. A LITTLE COMPANY."), /* @__PURE__ */ import_react.default.createElement("h1", null, "\u8BA9\u97F3\u4E50\uFF0C\u966A\u4F60\u4E00\u4F1A\u513F\u3002"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u4F60\u559C\u6B22\u7684\u65CB\u5F8B\uFF0C\u548C\u4E00\u4E2A\u61C2\u5F97\u8854\u63A5\u7684\u58F0\u97F3\u3002")), /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-frequency" }, "FM ", /* @__PURE__ */ import_react.default.createElement("b", null, "102.4"), /* @__PURE__ */ import_react.default.createElement("small", null, "YOUR OWN FREQUENCY"))), /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-stage" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-now-art" }, /* @__PURE__ */ import_react.default.createElement(Cover, { title: s.track?.title, large: true }), /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-art-caption" }, "YOUR PLAYLIST. YOUR MOMENT.")), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-player" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-pill" }, /* @__PURE__ */ import_react.default.createElement("i", { className: "ar-live-dot " + (!active ? "off" : "") }), s.speech ? "ON MIC" : active ? "ON AIR" : "READY WHEN YOU ARE"), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-track" }, /* @__PURE__ */ import_react.default.createElement("h2", null, s.track?.title || "\u4ECE\u4F60\u559C\u6B22\u7684\u6B4C\u5F00\u59CB"), /* @__PURE__ */ import_react.default.createElement("p", null, s.track?.artists.join(" / ") || "\u8FDE\u63A5\u7F51\u6613\u4E91\u6B4C\u5355\uFF0C\u6309\u4E0B\u64AD\u653E\u5C31\u597D\u3002"), /* @__PURE__ */ import_react.default.createElement("small", null, s.track?.album || "AI \u4E3B\u6301 \xB7 \u5929\u6C14\u4E0E\u65B0\u95FB \xB7 \u4E0D\u95F4\u65AD\u9009\u66F2")), /* @__PURE__ */ import_react.default.createElement(Spectrum, { controller, playing: active }), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-progress" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("i", { style: { width: `${Math.min(100, s.position / Math.max(1, s.duration) * 100)}%` } })), /* @__PURE__ */ import_react.default.createElement("span", null, time(s.position), /* @__PURE__ */ import_react.default.createElement("b", null, time(s.duration)))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-controls" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-icon-button", title: "\u591A\u653E\u4E00\u70B9\u7C7B\u4F3C\u7684\u6B4C", "aria-label": "\u559C\u6B22\u5F53\u524D\u97F3\u4E50", disabled: !s.track, onClick: () => controller.like() }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "heart", size: 23 })), /* @__PURE__ */ import_react.default.createElement("button", { "data-testid": "play", className: "ar-play", disabled: busy, "aria-label": active ? "\u6682\u505C\u7535\u53F0" : "\u64AD\u653E\u7535\u53F0", onClick: () => active ? controller.pause() : controller.play() }, busy ? /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-spinner" }) : /* @__PURE__ */ import_react.default.createElement(Icon, { name: active ? "pause" : "play", size: 28 })), /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-icon-button", title: "\u4E0B\u4E00\u9996", "aria-label": "\u4E0B\u4E00\u9996", disabled: !s.track, onClick: () => controller.next() }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "next", size: 23 })), /* @__PURE__ */ import_react.default.createElement("label", { className: "ar-volume" }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "volume", size: 17 }), /* @__PURE__ */ import_react.default.createElement("input", { "aria-label": "\u64AD\u653E\u97F3\u91CF", type: "range", min: "0", max: "1", step: "0.05", value: s.settings.volume, onChange: (e) => {
    const volume = Number(e.target.value);
    controller.emit({ settings: { ...s.settings, volume } });
    if (controller.master) controller.master.gain.value = volume;
  }, onPointerUp: (e) => controller.saveSettings({ volume: Number(e.target.value) }).catch(() => {
  }), onKeyUp: (e) => controller.saveSettings({ volume: Number(e.target.value) }).catch(() => {
  }) }))))), /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-below" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-host-card" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-host-avatar" }, host?.name?.slice(0, 1) || "\u6797", /* @__PURE__ */ import_react.default.createElement("i", null)), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-label" }, "\u672C\u65F6\u6BB5\u4E3B\u6301"), /* @__PURE__ */ import_react.default.createElement("h3", null, host?.name || "\u6797\u95F4 \xB7 \u591C\u822A"), /* @__PURE__ */ import_react.default.createElement("p", null, s.speech ? s.speech.text : host?.subtitle || "\u628A\u65E5\u5E38\u4EA4\u7ED9\u65CB\u5F8B\uFF0C\u628A\u966A\u4F34\u4EA4\u7ED9\u58F0\u97F3\u3002")), /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-text-button", onClick: () => controller.emit({ page: "settings" }) }, "\u6362\u4E2A\u58F0\u97F3 ", /* @__PURE__ */ import_react.default.createElement(Icon, { name: "arrow", size: 16 }))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-up-next" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-label" }, "UP NEXT ", /* @__PURE__ */ import_react.default.createElement("b", null, "\u63D0\u524D\u4E3A\u4F60\u51C6\u5907")), s.queue.length ? s.queue.slice(0, 3).map((item, i) => /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-queue-row", key: item.id }, /* @__PURE__ */ import_react.default.createElement("span", null, "0", i + 1), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("b", null, item.track.title), /* @__PURE__ */ import_react.default.createElement("small", null, item.track.artists.join(" / "))), /* @__PURE__ */ import_react.default.createElement("span", null, time(item.track.interval)))) : /* @__PURE__ */ import_react.default.createElement("p", { className: "ar-empty-inline" }, "\u64AD\u653E\u540E\uFF0C\u4E0B\u4E00\u6BB5\u8282\u76EE\u4F1A\u5728\u8FD9\u91CC\u7B49\u4F60\u3002"))));
}
function LibraryPage({ controller, state: s }) {
  const [selected, setSelected] = (0, import_react.useState)(s.settings.selectedPlaylistIds);
  const [qr, setQr] = (0, import_react.useState)(null);
  const [qrMessage, setQrMessage] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [cookie, setCookie] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    setSelected(s.settings.selectedPlaylistIds);
  }, [s.librarySyncedAt]);
  (0, import_react.useEffect)(() => {
    if (!qr) return;
    let disposed = false;
    let timer;
    const poll = async () => {
      try {
        const result = await api("/login/poll", { key: qr.key });
        if (disposed) return;
        setQrMessage(result.message);
        if (result.status === "success") {
          setQr(null);
          await controller.refresh();
          return;
        }
        if (result.status === "expired") {
          setQr(null);
          return;
        }
      } catch (error) {
        if (!disposed) setQrMessage(error.message);
      }
      if (!disposed) timer = setTimeout(poll, 2200);
    };
    timer = setTimeout(poll, 2e3);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [qr]);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      controller.emit({ notice: error.message });
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-eyebrow" }, "YOUR MUSIC, ON AIR."), /* @__PURE__ */ import_react.default.createElement("h1", null, "\u628A\u559C\u6B22\u7684\u6B4C\uFF0C\u5E26\u8FDB\u7535\u53F0\u3002"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u9009\u62E9\u4E00\u4E2A\u6216\u591A\u4E2A\u6B4C\u5355\u3002\u4E3B\u6301\u4EBA\u4F1A\u4ECE\u4E2D\u9009\u6B4C\uFF0C\u4E5F\u6162\u6162\u4E86\u89E3\u4F60\u7684\u504F\u597D\u3002")), s.account && /* @__PURE__ */ import_react.default.createElement(Button, { icon: "refresh", disabled: busy, onClick: () => run(async () => {
    await api("/playlists?refresh");
    await controller.refresh();
  }) }, "\u540C\u6B65\u6B4C\u5355")), !s.account ? /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-connect-card" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-connect-icon" }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "radio", size: 36 })), /* @__PURE__ */ import_react.default.createElement("h2", null, "\u8FDE\u63A5\u7F51\u6613\u4E91\u97F3\u4E50"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u7528\u7F51\u6613\u4E91\u97F3\u4E50 App \u626B\u7801\u767B\u5F55\uFF0C\u8BFB\u53D6\u4F60\u521B\u5EFA\u548C\u6536\u85CF\u7684\u6B4C\u5355\u3002"), qr ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("img", { alt: "\u7F51\u6613\u4E91\u767B\u5F55\u4E8C\u7EF4\u7801", className: "ar-qr", src: qr.imageDataUrl }), /* @__PURE__ */ import_react.default.createElement("p", null, qrMessage || "\u8BF7\u626B\u7801\uFF0C\u5E76\u5728\u624B\u673A\u4E0A\u786E\u8BA4")) : /* @__PURE__ */ import_react.default.createElement(Button, { className: "primary", disabled: busy, onClick: () => run(async () => {
    setQr(await api("/login/qr", {}));
    setQrMessage("");
  }) }, "\u626B\u7801\u8FDE\u63A5\u7F51\u6613\u4E91 ", /* @__PURE__ */ import_react.default.createElement(Icon, { name: "arrow", size: 18 })), /* @__PURE__ */ import_react.default.createElement("details", { className: "ar-advanced" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u4F7F\u7528\u5DF2\u6709\u767B\u5F55 Cookie"), /* @__PURE__ */ import_react.default.createElement("textarea", { "aria-label": "\u7F51\u6613\u4E91 Cookie", value: cookie, onChange: (e) => setCookie(e.target.value), placeholder: "\u7C98\u8D34\u4F60\u81EA\u5DF1\u7684\u7F51\u6613\u4E91\u767B\u5F55 Cookie\uFF08\u4EC5\u4FDD\u5B58\u5728\u672C\u673A\uFF09" }), /* @__PURE__ */ import_react.default.createElement(Button, { disabled: busy || !cookie, onClick: () => run(async () => {
    await api("/login/cookie", { cookie });
    setCookie("");
    await controller.refresh();
  }) }, "\u9A8C\u8BC1\u5E76\u8FDE\u63A5"))) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-library-summary" }, /* @__PURE__ */ import_react.default.createElement("span", null, s.playlists.length, " \u4E2A\u6B4C\u5355 \xB7 \u5DF2\u9009 ", selected.length, " \u4E2A"), /* @__PURE__ */ import_react.default.createElement(Button, { className: "primary", disabled: busy || !selected.length, onClick: () => run(async () => {
    await controller.loadLibrary(selected);
    controller.emit({ page: "radio" });
  }) }, busy ? "\u6B63\u5728\u8F7D\u5165\u2026" : "\u7528\u8FD9\u4E9B\u6B4C\u5355\u5F00\u53F0", " ", /* @__PURE__ */ import_react.default.createElement(Icon, { name: "arrow", size: 17 }))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-playlists" }, s.playlists.map((p) => /* @__PURE__ */ import_react.default.createElement("button", { key: p.id, className: "ar-playlist " + (selected.includes(p.id) ? "chosen" : ""), onClick: () => setSelected((xs) => xs.includes(p.id) ? xs.filter((x) => x !== p.id) : [...xs, p.id]) }, /* @__PURE__ */ import_react.default.createElement(Cover, { title: p.name }), /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-check" }, selected.includes(p.id) ? "\u2713" : "+"), /* @__PURE__ */ import_react.default.createElement("strong", null, p.name), /* @__PURE__ */ import_react.default.createElement("span", null, p.trackCount, " \u9996 \xB7 ", p.creator)))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-account-actions" }, /* @__PURE__ */ import_react.default.createElement("span", null, s.account.nickname, " \xB7 \u53EA\u6709\u8D26\u53F7\u6709\u6743\u6536\u542C\u7684\u5B8C\u6574\u6B4C\u66F2\u4F1A\u8FDB\u5165\u7535\u53F0"), /* @__PURE__ */ import_react.default.createElement("button", { className: "ar-text-button", onClick: () => run(async () => {
    controller.stop();
    await api("/logout", {});
    await controller.refresh();
  }) }, "\u9000\u51FA\u767B\u5F55"))));
}
function Field({ label, help, children }) {
  return /* @__PURE__ */ import_react.default.createElement("label", { className: "ar-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, label), children, help && /* @__PURE__ */ import_react.default.createElement("small", null, help));
}
function SettingsPage({ controller, state: s }) {
  const [form, setForm] = (0, import_react.useState)(() => structuredClone(s.settings));
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [saved, setSaved] = (0, import_react.useState)(false);
  const [voices, setVoices] = (0, import_react.useState)([]);
  const [feedText, setFeedText] = (0, import_react.useState)(s.settings.customFeeds.map((x) => `${x.title}|${x.url}`).join("\n"));
  (0, import_react.useEffect)(() => {
    const update = () => setVoices(window.speechSynthesis?.getVoices() || []);
    update();
    window.speechSynthesis?.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", update);
  }, []);
  const change = (key, value) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const nested = (group, key, value) => {
    setSaved(false);
    setForm((f) => ({ ...f, [group]: { ...f[group], [key]: value } }));
  };
  const save = async () => {
    setBusy(true);
    try {
      const customFeeds = feedText.split("\n").filter((x) => x.trim()).map((row, i) => {
        const [name, ...rest] = row.split("|");
        return rest.length ? { title: name.trim(), url: rest.join("|").trim() } : { title: `\u81EA\u9009\u6E90 ${i + 1}`, url: name.trim() };
      });
      await controller.saveSettings({ ...form, customFeeds });
      setSaved(true);
    } catch (error) {
      controller.emit({ notice: error.message });
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-eyebrow" }, "MAKE IT SOUND LIKE YOU."), /* @__PURE__ */ import_react.default.createElement("h1", null, "\u4F60\u7684\u7535\u53F0\uFF0C\u4F60\u6765\u8C03\u3002"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u6362\u4E00\u79CD\u58F0\u97F3\uFF0C\u6216\u7ED9\u4E3B\u6301\u4EBA\u4E00\u4E9B\u4ECA\u5929\u7684\u7EBF\u7D22\u3002")), /* @__PURE__ */ import_react.default.createElement(Button, { className: "primary", "data-testid": "save-settings", onClick: save, disabled: busy }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : saved ? "\u5DF2\u4FDD\u5B58 \u2713" : "\u4FDD\u5B58\u8BBE\u7F6E")), /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-settings-section" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "\u8C01\u6765\u966A\u4F60\u542C\u6B4C"), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-host-options" }, s.hosts.map((host, i) => /* @__PURE__ */ import_react.default.createElement("button", { key: host.id, className: form.hostId === host.id ? "chosen" : "", onClick: () => change("hostId", host.id) }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-host-avatar tone-" + i }, host.name.slice(0, 1)), /* @__PURE__ */ import_react.default.createElement("strong", null, host.name), /* @__PURE__ */ import_react.default.createElement("small", null, host.subtitle), form.hostId === host.id && /* @__PURE__ */ import_react.default.createElement("b", null, "\u2713"))))), /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-settings-section" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "\u58F0\u97F3\u4E0E\u8BF4\u8BDD\u65B9\u5F0F"), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-form-grid" }, /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u97F3\u8272\u670D\u52A1" }, /* @__PURE__ */ import_react.default.createElement("select", { value: form.tts.provider, onChange: (e) => nested("tts", "provider", e.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "browser" }, "\u7CFB\u7EDF\u97F3\u8272 \xB7 \u65E0\u9700\u5BC6\u94A5"), /* @__PURE__ */ import_react.default.createElement("option", { value: "openai" }, "OpenAI \u517C\u5BB9 TTS"), /* @__PURE__ */ import_react.default.createElement("option", { value: "fish" }, "Fish Audio"))), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u4E3B\u6301\u4EBA\u97F3\u8272" }, form.tts.provider === "browser" ? /* @__PURE__ */ import_react.default.createElement("select", { value: form.tts.voice, onChange: (e) => nested("tts", "voice", e.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "\u81EA\u52A8\u9009\u62E9\u4E2D\u6587\u97F3\u8272"), voices.map((v) => /* @__PURE__ */ import_react.default.createElement("option", { key: v.voiceURI, value: v.voiceURI }, v.name, " \xB7 ", v.lang))) : form.tts.provider === "openai" ? /* @__PURE__ */ import_react.default.createElement("input", { list: "ar-voice-list", value: form.tts.voice, onChange: (e) => nested("tts", "voice", e.target.value), placeholder: "nova / shimmer / \u81EA\u5B9A\u4E49\u97F3\u8272" }) : /* @__PURE__ */ import_react.default.createElement("input", { value: form.tts.fishVoiceId, onChange: (e) => nested("tts", "fishVoiceId", e.target.value), placeholder: "Fish \u97F3\u8272 Reference ID" }), /* @__PURE__ */ import_react.default.createElement("datalist", { id: "ar-voice-list" }, s.voices.map((v) => /* @__PURE__ */ import_react.default.createElement("option", { key: v.id, value: v.id }, v.name)))), /* @__PURE__ */ import_react.default.createElement(Field, { label: `\u8BED\u901F \xB7 ${form.tts.rate.toFixed(2)}\xD7` }, /* @__PURE__ */ import_react.default.createElement("input", { "aria-label": "\u4E3B\u6301\u8BED\u901F", type: "range", min: "0.7", max: "1.4", step: "0.05", value: form.tts.rate, onChange: (e) => nested("tts", "rate", Number(e.target.value)) })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u97F3\u8272\u8BD5\u542C", help: "\u8BD5\u542C\u524D\u8BF7\u5148\u4FDD\u5B58\u8BBE\u7F6E\u3002" }, /* @__PURE__ */ import_react.default.createElement(Button, { onClick: () => controller.previewVoice().catch((e) => controller.emit({ notice: e.message })) }, "\u542C\u542C\u8FD9\u4E2A\u58F0\u97F3 ", /* @__PURE__ */ import_react.default.createElement(Icon, { name: "play", size: 17 }))), form.tts.provider !== "browser" && /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u8BED\u97F3\u63A5\u53E3\u5730\u5740", help: "\u7559\u7A7A\u4F7F\u7528\u670D\u52A1\u5546\u9ED8\u8BA4\u5730\u5740\u3002" }, /* @__PURE__ */ import_react.default.createElement("input", { value: form.tts.baseUrl, onChange: (e) => nested("tts", "baseUrl", e.target.value), placeholder: form.tts.provider === "fish" ? "https://api.fish.audio" : "https://api.openai.com/v1" })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u8BED\u97F3\u6A21\u578B" }, /* @__PURE__ */ import_react.default.createElement("input", { value: form.tts.model, onChange: (e) => nested("tts", "model", e.target.value) })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u8BED\u97F3 API Key", help: s.settings.tts.hasKey ? "\u5DF2\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u7559\u7A7A\u4FDD\u7559\u539F\u5BC6\u94A5" : "\u4EC5\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u4E0D\u53D1\u7ED9\u6D4F\u89C8\u5668" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "password", autoComplete: "new-password", value: form.tts.apiKey || "", onChange: (e) => nested("tts", "apiKey", e.target.value), placeholder: "\u8F93\u5165\u5BC6\u94A5" }))))), /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-settings-section" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "\u4E3B\u6301\u4EBA\u7684 AI"), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-form-grid" }, /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u6A21\u578B\u6765\u6E90" }, /* @__PURE__ */ import_react.default.createElement("select", { value: form.llm.mode, onChange: (e) => nested("llm", "mode", e.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "dsh" }, "\u4F7F\u7528 DSH \u5DF2\u914D\u7F6E\u7684\u6A21\u578B"), /* @__PURE__ */ import_react.default.createElement("option", { value: "api" }, "OpenAI \u517C\u5BB9\u63A5\u53E3"))), form.llm.mode === "dsh" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(Field, { label: "DSH \u63D0\u4F9B\u65B9" }, /* @__PURE__ */ import_react.default.createElement("select", { value: form.llm.provider, onChange: (e) => {
    nested("llm", "provider", e.target.value);
    nested("llm", "model", "");
  } }, /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "\u8BF7\u9009\u62E9\u63D0\u4F9B\u65B9"), s.models?.map((p) => /* @__PURE__ */ import_react.default.createElement("option", { key: p.id, value: p.id }, p.name || p.id)))), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u4E3B\u6301\u6A21\u578B" }, /* @__PURE__ */ import_react.default.createElement("input", { list: "ar-model-list", value: form.llm.model, onChange: (e) => nested("llm", "model", e.target.value), placeholder: "\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B ID" }), /* @__PURE__ */ import_react.default.createElement("datalist", { id: "ar-model-list" }, s.models?.find((p) => p.id === form.llm.provider)?.models?.map((m) => /* @__PURE__ */ import_react.default.createElement("option", { key: m.id, value: m.id }, m.name))))) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(Field, { label: "AI \u63A5\u53E3\u5730\u5740" }, /* @__PURE__ */ import_react.default.createElement("input", { value: form.llm.baseUrl, onChange: (e) => nested("llm", "baseUrl", e.target.value), placeholder: "https://\u4F60\u7684\u670D\u52A1\u5546/v1" })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u6A21\u578B ID" }, /* @__PURE__ */ import_react.default.createElement("input", { value: form.llm.model, onChange: (e) => nested("llm", "model", e.target.value), placeholder: "\u586B\u5199\u670D\u52A1\u5546\u63D0\u4F9B\u7684\u6A21\u578B\u540D" })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "AI API Key", help: s.settings.llm.hasKey ? "\u5DF2\u4FDD\u5B58\uFF0C\u7559\u7A7A\u4FDD\u7559\u539F\u5BC6\u94A5" : "\u672C\u5730\u6A21\u578B\u670D\u52A1\u53EF\u7559\u7A7A" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "password", autoComplete: "new-password", value: form.llm.apiKey || "", onChange: (e) => nested("llm", "apiKey", e.target.value) }))))), /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-settings-section" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "\u6B64\u523B\u7684\u7EBF\u7D22"), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-form-grid" }, /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u5929\u6C14\u57CE\u5E02" }, /* @__PURE__ */ import_react.default.createElement("input", { value: form.city, onChange: (e) => change("city", e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u4E0A\u6D77" })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u65F6\u533A" }, /* @__PURE__ */ import_react.default.createElement("input", { value: form.timezone, onChange: (e) => change("timezone", e.target.value) })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u5173\u6CE8\u7684\u8BDD\u9898" }, /* @__PURE__ */ import_react.default.createElement("input", { value: form.interests, onChange: (e) => change("interests", e.target.value), placeholder: "\u79D1\u6280\u3001\u6587\u5316\u3001\u751F\u6D3B" })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u7ED9\u4E3B\u6301\u4EBA\u7684\u8865\u5145\u4FE1\u606F" }, /* @__PURE__ */ import_react.default.createElement("textarea", { value: form.extraContext, onChange: (e) => change("extraContext", e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u4ECA\u5929\u5728\u5199\u4EE3\u7801\uFF0C\u5E0C\u671B\u5C11\u8BF4\u4E00\u70B9\uFF0C\u591A\u653E\u8212\u7F13\u7684\u6B4C\u3002" })))), /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-settings-section" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "\u8282\u76EE\u8282\u594F"), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-form-grid" }, [["crossfadeSeconds", "\u6B4C\u66F2\u6E10\u53D8", "\u79D2", 0, 12], ["speechEvery", "\u5E38\u89C4\u4E32\u573A\u95F4\u9694", "\u9996\u6B4C", 1, 8], ["newsMinutes", "\u65B0\u95FB\u95F4\u9694", "\u5206\u949F", 5, 120], ["humorEvery", "\u8F7B\u677E\u4E00\u523B\u95F4\u9694", "\u9996\u6B4C\uFF080 \u5173\u95ED\uFF09", 0, 12]].map(([key, label, unit, min, max]) => /* @__PURE__ */ import_react.default.createElement(Field, { key, label: `${label} \xB7 ${form[key]} ${unit}` }, /* @__PURE__ */ import_react.default.createElement("input", { type: "range", min, max, step: "1", value: form[key], onChange: (e) => change(key, Number(e.target.value)) })))), /* @__PURE__ */ import_react.default.createElement(Field, { label: "\u81EA\u5B9A\u4E49\u65B0\u95FB RSS", help: "\u6BCF\u884C\u4E00\u4E2A\uFF1A\u540D\u79F0|https://\u65B0\u95FB\u6E90\u5730\u5740\uFF1B\u53EA\u64AD\u5F53\u524D\u65F6\u533A\u5F53\u5929\u53D1\u5E03\u7684\u6D88\u606F\u3002" }, /* @__PURE__ */ import_react.default.createElement("textarea", { value: feedText, onChange: (e) => setFeedText(e.target.value), placeholder: "\u6211\u7684\u65B0\u95FB\u6E90|https://example.com/feed.xml" }))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-settings-end" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u97F3\u4E50\u4F1A\u7EE7\u7EED\u3002\u65B0\u8BBE\u7F6E\u7528\u4E8E\u63A5\u4E0B\u6765\u7684\u8282\u76EE\u3002"), /* @__PURE__ */ import_react.default.createElement(Button, { className: "primary", onClick: save, disabled: busy }, saved ? "\u5DF2\u4FDD\u5B58 \u2713" : "\u4FDD\u5B58\u8BBE\u7F6E")));
}
function NewsPage({ controller, state: s }) {
  const [busy, setBusy] = (0, import_react.useState)(false);
  const refresh = async () => {
    setBusy(true);
    try {
      controller.emit({ context: await api("/context") });
    } catch (e) {
      controller.emit({ notice: e.message });
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-eyebrow" }, "A MOMENT WITH THE WORLD."), /* @__PURE__ */ import_react.default.createElement("h1", null, "\u4ECA\u5929\uFF0C\u4E16\u754C\u53D1\u751F\u4E86\u4EC0\u4E48\u3002"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u4FDD\u7559\u6765\u6E90\u548C\u53D1\u5E03\u65F6\u95F4\u3002\u4E3B\u6301\u4EBA\u5728\u5408\u9002\u7684\u65F6\u5019\uFF0C\u4E3A\u4F60\u804A\u51E0\u53E5\u3002")), /* @__PURE__ */ import_react.default.createElement(Button, { icon: "refresh", onClick: refresh, disabled: busy }, busy ? "\u5237\u65B0\u4E2D\u2026" : "\u5237\u65B0\u8D44\u8BAF")), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-news-list" }, s.context?.news?.length ? s.context.news.map((n) => /* @__PURE__ */ import_react.default.createElement("article", { key: n.id }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-label" }, n.category || "\u4ECA\u65E5\u8D44\u8BAF"), /* @__PURE__ */ import_react.default.createElement("time", null, new Date(n.publishedAt).toLocaleTimeString("zh-CN", { timeZone: s.settings.timezone, hour: "2-digit", minute: "2-digit" }))), /* @__PURE__ */ import_react.default.createElement("h2", null, /* @__PURE__ */ import_react.default.createElement("a", { href: n.url, target: "_blank", rel: "noreferrer" }, n.title)), /* @__PURE__ */ import_react.default.createElement("p", null, n.summary), /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-source" }, n.source, " ", /* @__PURE__ */ import_react.default.createElement(Icon, { name: "arrow", size: 14 })))) : /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-empty" }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "news", size: 38 }), /* @__PURE__ */ import_react.default.createElement("h2", null, "\u4ECA\u5929\u7684\u6D88\u606F\uFF0C\u6B63\u5728\u8DEF\u4E0A\u3002"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u6CA1\u6709\u83B7\u5F97\u53EF\u786E\u8BA4\u53D1\u5E03\u65F6\u95F4\u7684\u65B0\u95FB\u65F6\uFF0C\u7535\u53F0\u4F1A\u7EE7\u7EED\u653E\u97F3\u4E50\u3002"))), s.context?.newsFailures?.length > 0 && /* @__PURE__ */ import_react.default.createElement("p", { className: "ar-subtle" }, "\u6682\u672A\u8FDE\u63A5\uFF1A", s.context.newsFailures.join("\u3001")));
}
function HistoryPage({ controller, state: s }) {
  const [history, setHistory] = (0, import_react.useState)(s.history || []);
  (0, import_react.useEffect)(() => {
    api("/history").then(setHistory).catch(() => {
    });
  }, []);
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("section", { className: "ar-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-eyebrow" }, "THE SOUND OF YOUR DAYS."), /* @__PURE__ */ import_react.default.createElement("h1", null, "\u6BCF\u4E00\u9996\uFF0C\u90FD\u7559\u4E0B\u4E86\u75D5\u8FF9\u3002"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u559C\u6B22\u3001\u542C\u5B8C\u6216\u8DF3\u8FC7\uFF0C\u90FD\u8BA9\u4E0B\u4E00\u6BB5\u8282\u76EE\u66F4\u61C2\u4F60\u3002"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-history" }, history.length ? history.map((h, i) => /* @__PURE__ */ import_react.default.createElement("div", { key: h.eventId || i }, /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-history-index" }, String(i + 1).padStart(2, "0")), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, h.title), /* @__PURE__ */ import_react.default.createElement("small", null, h.artists?.join(" / "))), /* @__PURE__ */ import_react.default.createElement("span", { className: "ar-event " + h.action }, { played: "\u5DF2\u6536\u542C", skipped: "\u5DF2\u8DF3\u8FC7", liked: "\u559C\u6B22", failed: "\u6682\u4E0D\u53EF\u64AD" }[h.action]), /* @__PURE__ */ import_react.default.createElement("time", null, new Date(h.at).toLocaleString("zh-CN", { timeZone: s.settings.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })))) : /* @__PURE__ */ import_react.default.createElement("div", { className: "ar-empty" }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "history", size: 38 }), /* @__PURE__ */ import_react.default.createElement("h2", null, "\u7B2C\u4E00\u6BB5\u6545\u4E8B\uFF0C\u4ECE\u64AD\u653E\u5F00\u59CB\u3002"))));
}

// client/style.css
var style_default = '.ar-root{--ar-bg:#101511;--ar-panel:#161d18;--ar-border:#ffffff12;--ar-text:#e9ede5;--ar-muted:#8e9b90;--ar-accent:#c3e7aa;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;color:var(--ar-text);text-align:left;color-scheme:dark;letter-spacing:.1px}.ar-root *{box-sizing:border-box}.ar-root :where(button,input,select,textarea){font:inherit}.ar-root button{cursor:pointer;transition:background .18s,transform .18s}.ar-root button:disabled{opacity:.45;cursor:default}.ar-root button:focus-visible,.ar-root input:focus-visible,.ar-root select:focus-visible,.ar-root textarea:focus-visible{outline:2px solid var(--ar-accent);outline-offset:3px}.ar-root button{color:inherit}.ar-root h1,.ar-root h2,.ar-root h3,.ar-root p{margin:0}.ar-root a{color:inherit;text-decoration:none}.ar-root button svg{flex-shrink:0}.ar-root input[type=range]{accent-color:var(--ar-accent);cursor:pointer;padding:0;height:24px}.ar-backdrop{position:fixed;inset:0;background:#0008;z-index:1100;display:grid;place-items:center;padding:24px;backdrop-filter:blur(10px)}.ar-window{display:flex;width:min(1160px,96vw);height:min(800px,92vh);background:var(--ar-bg);border:1px solid #ffffff16;border-radius:18px;overflow:hidden;box-shadow:0 40px 100px #0005}.ar-standalone{min-height:100vh;background:#090d0b;display:flex;align-items:center;justify-content:center;padding:28px}.ar-standalone .ar-window{width:min(1280px,96vw);height:min(870px,94vh);min-height:650px}.ar-sidebar{width:224px;flex-shrink:0;background:#141b16;border-right:1px solid var(--ar-border);padding:30px 20px 18px;display:flex;flex-direction:column}.ar-brand,.ar-mini-brand{background:none;border:0;display:flex;align-items:center;gap:10px;text-align:left;padding:0}.ar-brand{font-size:24px;letter-spacing:-1px}.ar-brand b,.ar-mini-brand b{font-weight:400;color:var(--ar-accent)}.ar-brand small{display:block;color:#6f8476;font-size:8px;letter-spacing:2px;margin-top:2px}.ar-brand-icon{color:var(--ar-accent);border:1px solid #c3e7aa3b;padding:9px;display:flex;border-radius:12px}.ar-nav-label{margin:51px 12px 12px;font-size:10px;color:#697c6d;letter-spacing:1px}.ar-sidebar nav{display:grid;gap:7px}.ar-sidebar nav button,.ar-settings-nav{display:flex;align-items:center;gap:12px;padding:12px 14px;border:0;border-radius:8px;background:none;color:var(--ar-muted);font-size:13px;text-align:left;width:100%}.ar-sidebar nav button:hover,.ar-settings-nav:hover{background:#ffffff05;color:var(--ar-text)}.ar-sidebar button.selected{color:var(--ar-accent);background:#c3e7aa0d}.ar-sidebar nav .ar-live-dot{margin-left:auto}.ar-sidebar-bottom{margin-top:auto}.ar-sidebar-note{margin:20px 8px 25px;color:#92a38e;font-size:11px}.ar-sidebar-note small{display:block;font-size:10px;color:#52695c;margin:5px 0 0 18px}.ar-tiny-star{color:var(--ar-accent);margin-right:5px}.ar-account{display:flex;align-items:center;gap:10px;padding:20px 6px 0;margin-top:15px;border-top:1px solid var(--ar-border);font-size:12px}.ar-account small{display:block;font-size:10px;color:var(--ar-muted)}.ar-avatar{width:33px;height:33px;display:grid;place-items:center;border-radius:50%;background:#2b3c2b;color:var(--ar-accent)}.ar-main{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}.ar-topbar{height:68px;flex-shrink:0;display:flex;justify-content:space-between;align-items:center;padding:0 35px;border-bottom:1px solid var(--ar-border);font-size:11px;color:var(--ar-muted)}.ar-topbar>span,.ar-topbar>div{display:flex;align-items:center;gap:10px}.ar-topbar>div{gap:17px}.ar-topbar time{font-size:13px;letter-spacing:1px;font-variant-numeric:tabular-nums;color:#b5c4b7}.ar-weather{display:flex;align-items:center;gap:7px}.ar-top-divider{height:13px;width:1px;background:#ffffff15}.ar-live-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--ar-accent);box-shadow:0 0 9px #c3e7aa45}.ar-live-dot.off{background:#728078;box-shadow:none}.ar-demo-badge{font-size:9px;background:#b98c461f;color:#d1b07e;padding:2px 6px;border-radius:4px;font-weight:400}.ar-content{flex:1;overflow:auto;padding:31px 35px 24px;scrollbar-width:thin;scrollbar-color:#2f3f33 transparent}.ar-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:30px}.ar-eyebrow{font-size:9px;color:#7e9e81;letter-spacing:2px}.ar-heading h1{font-weight:500;font-size:27px;letter-spacing:1px;margin:9px 0 6px}.ar-heading p{font-size:11px;color:var(--ar-muted)}.ar-frequency{font-size:10px;color:#76907b;text-align:right;white-space:nowrap;letter-spacing:1px}.ar-frequency b{font-size:29px;font-weight:300;color:#b9cbb5;letter-spacing:-1px}.ar-frequency small{display:block;font-size:7px;letter-spacing:1.4px;margin-top:-3px}.ar-stage{display:grid;grid-template-columns:minmax(180px,.9fr) minmax(250px,1.12fr);gap:36px;align-items:center;background:radial-gradient(ellipse at 20% 10%,#27473230,transparent 75%),#151d17;border:1px solid #d7e9c20f;border-radius:14px;padding:30px}.ar-now-art{min-width:0;display:flex;align-items:center;flex-direction:column}.ar-cover{position:relative;width:100%;aspect-ratio:1;border-radius:7px;overflow:hidden;background:radial-gradient(ellipse at 60% 13%,#a1bb724a,transparent 65%),radial-gradient(ellipse at 5% 90%,#1d4a2b,transparent 70%),linear-gradient(145deg,#2a3e30,#0e2920);display:flex;flex-direction:column;justify-content:center;align-items:center;isolation:isolate;filter:hue-rotate(var(--cover-hue));box-shadow:0 15px 30px #0002}.ar-cover.large{max-width:285px;border:1px solid #dcf9ce20;box-shadow:0 16px 36px #0005;transform:rotate(-2deg)}.ar-cover:before,.ar-cover:after{content:"";position:absolute;inset:50% -40% -60%;border-radius:50%;border:1px solid #c3d8bb35;box-shadow:0 -10px 80px #cee8b42a;transform:rotate(-30deg);z-index:-1}.ar-cover:after{inset:65% -35% -30%;background:#254d3645;transform:rotate(25deg)}.ar-cover-orbit{position:absolute;border:1px solid #e0edb536;width:75%;height:75%;border-radius:50%;transform:rotate(40deg) scaleX(.6)}.ar-cover span{font-size:25px;letter-spacing:7px;font-family:Georgia,"Microsoft YaHei",serif;color:#e4e9c7;font-weight:300;text-align:center;padding:16px}.ar-cover small{font-size:6px;letter-spacing:2px;color:#c1ccb388;position:absolute;bottom:14%}.ar-cover.large span{font-size:28px;letter-spacing:9px}.ar-art-caption{font-size:7px;letter-spacing:2px;color:#6c8570;margin-top:19px}.ar-player{min-width:0}.ar-pill{font-size:8px;letter-spacing:1.5px;color:var(--ar-accent);display:inline-flex;align-items:center;gap:7px;background:#b8da9e08;border:1px solid #b8da9e1a;border-radius:20px;padding:3px 9px}.ar-track{margin-top:19px}.ar-track h2{font-weight:400;font-size:27px;line-height:1.4;letter-spacing:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ar-track p{font-size:12px;color:#bac6b7;margin-top:9px}.ar-track small{font-size:10px;color:#68826c;display:block;margin-top:5px}.ar-spectrum{width:100%;height:45px;display:block;margin:18px 0 8px;opacity:.85}.ar-progress>div{height:2px;background:#d1e6bf15;border-radius:2px;overflow:hidden}.ar-progress i{display:block;height:100%;background:var(--ar-accent);transition:width 1s linear}.ar-progress>span{display:block;margin:8px 0 16px;font-size:9px;font-variant-numeric:tabular-nums;color:#7d9783}.ar-progress b{float:right;font-weight:400}.ar-controls{display:flex;align-items:center;gap:16px}.ar-icon-button{border:0;background:none;display:inline-flex;align-items:center;justify-content:center;color:#a7b8a5;padding:6px;border-radius:6px}.ar-icon-button:hover{background:#ffffff09;color:var(--ar-accent)}.ar-play{height:53px;width:53px;border-radius:50%;background:var(--ar-accent);color:#1b2a1b!important;border:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 22px #b5e09d0c}.ar-play:hover{transform:scale(1.04);background:#d2f2bd}.ar-volume{display:flex;align-items:center;gap:5px;min-width:40px;margin-left:auto;color:#7b947b}.ar-volume input{width:64px;height:3px!important}.ar-below{display:grid;grid-template-columns:1.1fr 1fr;gap:20px;margin-top:25px}.ar-host-card{display:flex;align-items:flex-start;gap:12px;background:#182019;border:1px solid var(--ar-border);border-radius:11px;padding:19px;position:relative;min-height:155px}.ar-host-avatar{position:relative;border-radius:50%;background:linear-gradient(145deg,#577052,#283d30);color:#d3dfbf;font-family:Georgia,serif;font-size:19px;width:42px;height:42px;display:grid;place-items:center;flex-shrink:0}.ar-host-avatar i{position:absolute;right:0;bottom:2px;width:8px;height:8px;background:var(--ar-accent);border-radius:50%;border:2px solid #182019}.ar-label{font-size:8px;letter-spacing:1.5px;color:#829b7e}.ar-host-card h3{font-size:12px;font-weight:500;margin:2px 0 6px}.ar-host-card p{font-size:10px;color:#8a9c8a;line-height:1.8;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-width:300px}.ar-text-button{border:0;background:none;display:inline-flex;align-items:center;gap:5px;font-size:10px!important;color:var(--ar-accent)!important;padding:0;white-space:nowrap}.ar-host-card>.ar-text-button{position:absolute;bottom:15px;right:16px;font-size:9px!important}.ar-up-next{padding:5px 0}.ar-label>b{float:right;font-size:9px;letter-spacing:0;color:#526d5a;font-weight:400}.ar-queue-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #ffffff08;font-size:9px}.ar-queue-row>span{color:#536e5b;font-variant-numeric:tabular-nums}.ar-queue-row>span:last-child{margin-left:auto}.ar-queue-row>div{min-width:0}.ar-queue-row b{font-size:10px;font-weight:400;display:block;color:#bdcdb9;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:180px}.ar-queue-row small{color:#68826e;font-size:8px}.ar-empty-inline{color:#637b68;font-size:10px;padding-top:20px;line-height:1.9}.ar-footer{border-top:1px solid var(--ar-border);padding:12px 35px;display:flex;align-items:center;justify-content:space-between;color:#5e7865;font-size:8px;flex-shrink:0}.ar-footer .ar-live-dot{width:4px;height:4px;margin-right:7px;opacity:.7}.ar-notice{display:flex;justify-content:space-between;gap:15px;background:#292c1e;border-top:1px solid #c6bf6c1a;color:#c8c79c;font-size:11px;padding:10px 35px}.ar-notice button{border:0;background:none;color:inherit;font-size:17px;line-height:1}.ar-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 15px;background:#ffffff05;border:1px solid #ffffff18;border-radius:7px;font-size:11px!important;white-space:nowrap;color:#becbbb}.ar-button:hover{background:#ffffff0b}.ar-button.primary{background:var(--ar-accent);color:#21341e;border-color:var(--ar-accent);font-weight:500}.ar-button.primary:hover{background:#d2efc0}.ar-connect-card{border:1px solid var(--ar-border);border-radius:14px;text-align:center;padding:50px 24px;background:radial-gradient(ellipse at center top,#31543338,transparent 80%),#151d17;max-width:650px;margin:20px auto}.ar-connect-icon{width:68px;height:68px;border:1px solid #c3e7aa23;border-radius:18px;display:grid;place-items:center;margin:0 auto 20px;color:var(--ar-accent)}.ar-connect-card h2{font-size:21px;font-weight:400}.ar-connect-card>p{color:var(--ar-muted);font-size:12px;margin:10px 0 25px}.ar-qr{width:185px;padding:10px;background:white;border-radius:8px;margin-top:20px}.ar-advanced{max-width:450px;text-align:left;margin:30px auto 0;color:var(--ar-muted);font-size:11px}.ar-advanced summary{cursor:pointer;text-align:center}.ar-advanced textarea{margin:12px 0;width:100%;background:#111914;border:1px solid var(--ar-border);border-radius:6px;padding:10px;color:var(--ar-text);height:90px;resize:vertical}.ar-library-summary{display:flex;align-items:center;justify-content:space-between;color:var(--ar-muted);font-size:11px;margin-bottom:20px}.ar-playlists{display:grid;grid-template-columns:repeat(3,1fr);gap:22px 18px}.ar-playlist{position:relative;border:1px solid transparent;padding:10px;border-radius:10px;background:transparent;text-align:left;min-width:0}.ar-playlist:hover{background:#ffffff04}.ar-playlist.chosen{border-color:#c3e7aa50;background:#c3e7aa05}.ar-playlist .ar-cover{aspect-ratio:1.12}.ar-playlist .ar-cover span{font-size:19px;letter-spacing:4px}.ar-playlist strong{display:block;font-size:12px;font-weight:400;margin-top:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ar-playlist>span:last-child{display:block;font-size:9px;color:var(--ar-muted);margin-top:3px}.ar-check{position:absolute;right:18px;top:18px;border-radius:50%;height:23px;width:23px;background:#112016b0;border:1px solid #c3e7aa70;display:grid;place-items:center;font-size:13px;color:var(--ar-accent)}.ar-chosen .ar-check{background:var(--ar-accent)}.ar-account-actions{display:flex;align-items:center;justify-content:space-between;margin:30px 0;font-size:10px;color:#687d6b}.ar-settings-section{padding:23px 0;border-bottom:1px solid var(--ar-border)}.ar-settings-section:first-of-type{padding-top:3px}.ar-settings-section h2{font-size:13px;font-weight:500;margin-bottom:18px}.ar-host-options{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.ar-host-options button{border:1px solid #ffffff12;border-radius:9px;background:#ffffff02;text-align:left;padding:17px;position:relative}.ar-host-options button.chosen{border-color:#c3e7aa88;background:#c3e7aa06}.ar-host-options .ar-host-avatar{width:35px;height:35px;font-size:16px;margin-bottom:12px}.tone-1{background:linear-gradient(145deg,#846b40,#453f25)}.tone-2{background:linear-gradient(145deg,#596778,#2e3f4b)}.ar-host-options strong{display:block;font-size:11px;font-weight:500}.ar-host-options small{font-size:9px;color:var(--ar-muted);display:block;margin-top:4px}.ar-host-options b{position:absolute;top:14px;right:14px;color:var(--ar-accent);font-weight:400}.ar-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:21px 23px}.ar-field{display:flex;flex-direction:column;gap:7px;font-size:11px;color:#a3b3a1}.ar-field>span{font-size:10px}.ar-field input:not([type=range]),.ar-field textarea,.ar-field select{background:#141c16;border:1px solid #ffffff13;border-radius:6px;color:#cbd7c6;padding:9px 11px;width:100%;min-width:0;font-size:11px;line-height:1.7}.ar-field textarea{resize:vertical;min-height:70px}.ar-field small{font-size:9px;color:#627b67}.ar-settings-section>.ar-field{margin-top:21px}.ar-settings-end{display:flex;align-items:center;justify-content:space-between;padding:24px 0 0;font-size:10px;color:var(--ar-muted)}.ar-news-list{display:grid;gap:14px}.ar-news-list article{background:#151e17;border:1px solid var(--ar-border);padding:20px 23px;border-radius:10px}.ar-news-list article>div{display:flex;justify-content:space-between}.ar-news-list time{font-size:9px;color:#627a66}.ar-news-list h2{font-size:16px;font-weight:400;margin:10px 0 8px}.ar-news-list h2 a:hover{color:var(--ar-accent)}.ar-news-list p{font-size:11px;color:#8c9d8c;line-height:1.9}.ar-source{display:flex;align-items:center;gap:8px;font-size:9px;color:#a7bf96;margin-top:15px}.ar-empty{padding:65px 20px;text-align:center;color:#6d8772}.ar-empty>svg{margin-bottom:20px}.ar-empty h2{font-size:18px;font-weight:400;color:#aabda5;margin-bottom:10px}.ar-empty p,.ar-subtle{font-size:11px;color:#718674}.ar-subtle{margin-top:20px!important}.ar-history>div:not(.ar-empty){display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--ar-border);padding:14px 0}.ar-history-index{font-size:10px;color:#4d6855}.ar-history strong{font-size:12px;font-weight:400;display:block}.ar-history small{display:block;font-size:10px;color:#718674;margin-top:3px}.ar-event{margin-left:auto;font-size:9px;color:#859b80;background:#ffffff04;padding:3px 8px;border-radius:4px}.ar-event.liked{color:var(--ar-accent)}.ar-history time{font-size:9px;color:#657d69}.ar-mini{display:flex;align-items:center;gap:12px;border:1px solid var(--ar-border);border-radius:10px;background:#17201a;padding:8px 12px;width:min(600px,100%);margin:0 auto;box-shadow:0 4px 15px #0001}.ar-mini-brand{font-size:13px;gap:7px;color:var(--ar-accent)!important;white-space:nowrap}.ar-mini-title{font-size:11px;color:#9cad9a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ar-loading{padding:20px;color:var(--ar-accent);font-size:12px}.ar-spinner{width:20px;height:20px;border:2px solid #1b2a1b44;border-top-color:#1b2a1b;border-radius:50%;animation:ar-spin .8s linear infinite}@keyframes ar-spin{to{transform:rotate(360deg)}}@media(min-width:1200px){.ar-standalone .ar-content{padding:36px 43px 30px}.ar-standalone .ar-stage{gap:42px;padding:37px}.ar-standalone .ar-heading{margin-bottom:32px}.ar-standalone .ar-below{margin-top:28px}}@media(max-width:980px){.ar-sidebar{width:180px;padding:25px 14px 16px}.ar-brand{font-size:20px}.ar-brand-icon{padding:7px}.ar-content{padding:25px}.ar-topbar{padding:0 25px}.ar-stage{gap:23px;padding:23px;grid-template-columns:1fr 1.2fr}.ar-heading h1{font-size:24px}.ar-track h2{font-size:23px}.ar-below{grid-template-columns:1fr}.ar-up-next{padding:10px}.ar-standalone .ar-window{height:94vh;min-height:650px}.ar-host-options{gap:8px}.ar-host-options button{padding:12px}.ar-frequency{display:none}}@media(max-width:700px){.ar-standalone{padding:0}.ar-window,.ar-standalone .ar-window{width:100%;height:100dvh;min-height:0;border-radius:0;border:0}.ar-backdrop{padding:0}.ar-sidebar{width:65px;padding:23px 8px 14px}.ar-brand{justify-content:center}.ar-brand>span:last-child,.ar-nav-label,.ar-sidebar-note,.ar-account,.ar-sidebar nav button>.ar-live-dot{display:none}.ar-sidebar nav{margin-top:38px}.ar-sidebar nav button,.ar-settings-nav{font-size:0;padding:13px;justify-content:center;gap:0}.ar-sidebar nav button svg,.ar-settings-nav svg{width:20px;height:20px}.ar-settings-nav{margin-bottom:5px}.ar-brand-icon{padding:6px}.ar-content{padding:25px 20px}.ar-heading h1{font-size:22px}.ar-heading p{font-size:10px}.ar-eyebrow{font-size:7px;letter-spacing:1.4px}.ar-topbar{padding:0 20px;height:56px;font-size:9px}.ar-topbar>div{gap:10px}.ar-topbar time{font-size:11px}.ar-weather{font-size:9px}.ar-top-divider{display:none}.ar-stage{grid-template-columns:1fr;padding:25px;gap:22px}.ar-cover.large{max-width:225px}.ar-track{margin-top:14px}.ar-art-caption{display:none}.ar-spectrum{margin-top:8px}.ar-player .ar-pill{font-size:7px}.ar-below{margin-top:18px}.ar-host-card{padding:16px;min-height:145px}.ar-footer{padding:12px 18px;font-size:7px}.ar-footer>span:last-child{display:none}.ar-notice{padding:10px 18px;font-size:10px}.ar-form-grid{grid-template-columns:1fr}.ar-host-options{grid-template-columns:1fr}.ar-host-options button{display:grid;grid-template-columns:40px 1fr;column-gap:10px;align-items:center}.ar-host-options .ar-host-avatar{grid-row:span 2;margin-bottom:0}.ar-host-options strong,.ar-host-options small{grid-column:2}.ar-host-options small{margin-top:0}.ar-playlists{grid-template-columns:repeat(2,1fr);gap:12px}.ar-playlist{padding:7px}.ar-playlist strong{font-size:10px}.ar-playlist .ar-cover span{font-size:14px;letter-spacing:2px}.ar-library-summary{gap:12px;align-items:flex-start}.ar-button{font-size:10px!important;padding:8px 11px}.ar-heading>.ar-button{font-size:9px!important}.ar-account-actions{flex-direction:column;gap:12px;align-items:flex-start}.ar-history time{display:none}.ar-event{white-space:nowrap}.ar-connect-card{padding:35px 18px}.ar-connect-card h2{font-size:18px}.ar-connect-card>p{font-size:11px}}@media(prefers-reduced-motion:reduce){.ar-root *{transition:none!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}\n';

// client/index.jsx
var inject = ["slots"];
function apply(ctx) {
  const controller = new RadioController();
  const slots = ctx.get("slots");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-ai-radio";
    style.textContent = style_default;
    document.head.append(style);
    return () => style.remove();
  }, "ai-radio: styles");
  ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register({ name: "conversation.input.dock", id: "ai-radio-player", order: 42 }, () => import_react2.default.createElement(App, { controller, miniOnly: true }))), "ai-radio: dock");
  ctx.effect(() => slots.inject("shell.overlay", () => slots.register({ name: "shell.overlay", id: "ai-radio-panel", order: 24 }, () => import_react2.default.createElement(App, { controller, panelOnly: true }))), "ai-radio: panel");
  ctx.effect(() => () => controller.dispose(), "ai-radio: browser cleanup");
  controller.init();
}

return module.exports;}});
