import { createHash, randomUUID } from 'node:crypto';
import { Planner, extractJson } from './planner.js';
import { HOSTS, cleanText } from './store.js';
import { freshNews, localDate } from './context.js';
import { MusicResearch } from './research.js';
import { DIRECTOR_PROMPT, SCRIPT_PROMPT, WHALE_PERSONA } from './prompts.js';
import { programmeTimeline } from './timeline.js';

const compactSong = s => ({ id: s.id, title: s.title, artists: s.artists, album: s.album, interval: s.interval, playlists: s.playlistNames });
const CHAPTER_SIZE = 8;
const safeIntro = (song, previous) => (previous ? '刚刚听过《' + previous.title + '》，接下来换一段旋律。' : '今天的第一首，') + '一起听' + song.artists.join('、') + '的《' + song.title + '》。' + (song.album ? '这首收录在《' + song.album + '》里。' : '') + '小鲸先把麦克风放低，我们认真听。';

export class Programme extends Planner {
  constructor(store, context, options = {}) {
    super(store, context, options);
    this.research = options.research || new MusicResearch(store, options);
    this.prepareAudio = options.prepareAudio;
    this.current = store.state.programme || null; this.cursor = 0; this.round = 0; this.epoch = 0;
    this.job = { status: 'idle', phase: '', done: 0, total: 0 };
    this.lastRenewAt = 0;
  }
  signature(query = '') {
    const s = this.store.state.settings;
    return createHash('sha256').update(JSON.stringify({
      date: localDate(this.now(), s.timezone), library: this.store.state.library.map(compactSong),
      hostId: s.hostId, persona: s.persona, city: s.city, timezone: s.timezone, interests: s.interests,
      extraContext: s.extraContext, newsMinutes: s.newsMinutes, humorEvery: s.humorEvery, feeds: s.customFeeds, query,
    })).digest('hex');
  }
  audioSignature(settings = this.store.state.settings) {
    const { apiKey, ...tts } = settings.tts;
    const credential = createHash('sha256').update(apiKey || process.env.AI_RADIO_TTS_KEY || '').digest('hex');
    return createHash('sha256').update(JSON.stringify({ version: 2, tts, credential, crossfadeSeconds: settings.crossfadeSeconds })).digest('hex');
  }
  summary() {
    const p = this.current;
    return { ...this.job, elapsedMs: this.job.startedAt ? Math.max(0, this.now() - this.job.startedAt) : 0, programme: p ? { id: p.id, title: p.title, trackCount: p.segments.length, researched: p.researched, missingResearch: p.missingResearch,
      createdAt: p.generatedAt, mode: p.mode, cursor: this.cursor, chapters: p.arc?.map(x => x.title) || [] } : null };
  }
  invalidate() {
    this.epoch++; this.abort?.abort(); this.abort = null; this.preparing = null;
    this.current = null; this.nextProgramme = null; this.cursor = 0; this.round = 0; this.inflight.clear();
    this.store.state.programme = null; this.job = { status: 'idle', phase: '', done: 0, total: 0 };
  }
  cancel() {
    this.epoch++; this.abort?.abort(); this.preparing = null;
    this.job = { ...this.job, status: this.current ? 'ready' : 'cancelled', phase: '' };
  }
  start({ query = '', force = false } = {}) {
    query = cleanText(query, 150);
    const signature = this.signature(query);
    if (!force && this.preparing && this.job.signature === signature) return this.summary();
    const cached = !force && this.current?.signature === signature && this.now() - this.current.generatedAt < 20 * 60000 ? this.current : null;
    if (cached && (!this.prepareAudio || cached.audioSignature === this.audioSignature())) { this.job.status = 'ready'; return this.summary(); }
    this.abort?.abort(); const abort = this.abort = new AbortController(); const epoch = ++this.epoch;
    if (force) this.store.state.programmeDraft = null;
    this.job = { id: randomUUID(), status: 'preparing', phase: '正在整理歌单与今天的线索', done: 0, total: this.store.state.library.length, signature, startedAt: this.now() };
    const progress = patch => {
      if (epoch !== this.epoch) return;
      this.job = { ...this.job, ...(patch.phase && patch.phase !== this.job.phase ? { model: null } : {}), ...patch, updatedAt: this.now() };
    };
    const work = cached ? this.calibrateAudio(structuredClone(cached), { signal: abort.signal, progress }) : this.build({ query, signature, signal: abort.signal, progress });
    this.preparing = work.then(p => {
      if (epoch !== this.epoch) return null;
      this.current = p; this.cursor = 0; this.round = 0; this.nextProgramme = null; this.inflight.clear();
      this.store.state.programme = p; this.store.state.programmeDraft = null; this.store.save(); progress({ status: 'ready', phase: '节目稿已准备好', done: p.segments.length, total: p.segments.length });
      return p;
    }).catch(error => {
      if (epoch === this.epoch) progress({ status: abort.signal.aborted ? 'cancelled' : 'failed', error: cleanText(error.message, 220), errorCode: error.code || '', phase: '' });
      return null;
    }).finally(() => { if (epoch === this.epoch) this.preparing = null; });
    return this.summary();
  }
  async build({ query, signature, signal, progress = () => {}, draftKey = 'initial' }) {
    const state = this.store.state;
    const library = structuredClone(state.library); const settings = structuredClone(state.settings);
    if (!library.length) throw new Error('请先登录并载入歌单');
    const host = HOSTS.find(x => x.id === settings.hostId) || HOSTS[0];
    const persona = [WHALE_PERSONA, host.style, settings.persona].filter(Boolean).join('\n');
    const route = JSON.stringify([settings.llm.mode, settings.llm.provider, settings.llm.model, settings.llm.baseUrl]);
    const saved = state.programmeDraft;
    const draft = saved?.signature === signature && saved.route === route && saved.key === draftKey ? saved : { signature, route, key: draftKey, chapters: {}, supplements: [], calls: [] };
    draft.chapters ||= {}; draft.supplements ||= []; draft.calls ||= [];
    const checkpoint = () => { signal.throwIfAborted(); state.programmeDraft = draft; this.store.save(); };
    const callJson = async (prompt, payload, maxTokens, reasoningEffort) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        signal.throwIfAborted();
        const limit = Math.min(65536, maxTokens * (attempt + 1));
        progress({ model: { phase: 'connecting', attempt: attempt + 1, maxTokens: limit, startedAt: this.now() } });
        let finalModel;
        try {
          const text = await this.generate(settings.llm, this.llm, persona + '\n' + prompt, payload, undefined, {
            maxTokens: limit, timeoutMs: 360000, signal, reasoningEffort,
            onProgress: model => { finalModel = model; progress({ model: { ...model, attempt: attempt + 1 } }); },
          });
          const value = extractJson(text);
          if (payload.stage === 'director' ? !Array.isArray(value.order) : !Array.isArray(value.songs)) throw new Error('模型稿件格式不完整');
          draft.calls.push({ stage: payload.stage, maxTokens: limit, reasoningEffort: finalModel?.reasoningEffort || reasoningEffort,
            textChars: text.length, reasoningChars: finalModel?.reasoningChars, finishKind: finalModel?.finishKind, elapsedMs: finalModel?.elapsedMs, attempt: attempt + 1 });
          return value;
        } catch (error) {
          signal.throwIfAborted();
          progress({ retryReason: cleanText(error.message, 180) });
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    };
    const context = await this.context.assemble(); signal.throwIfAborted();
    progress({ phase: '正在检索每首歌的背景与歌手资料' });
    const research = await this.research.all(library, { signal, onProgress: (done, total, title) => progress({ done, total, detail: title }) });
    const facts = new Map(research.map(x => [x.songId, x]));
    const news = freshNews([...context.news], this.now(), settings.timezone).slice(0, 12);
    progress({ phase: '正在构思整期主题、情绪曲线与播放顺序', done: 0, total: library.length, detail: '' });
    const brief = draft.brief || await callJson(DIRECTOR_PROMPT, {
      stage: 'director', date: localDate(this.now(), settings.timezone), time: context.localTime, weather: context.weather,
      interests: settings.interests, listenerNotes: settings.extraContext, request: query, songs: library.map(compactSong),
      researchOverview: research.map(x => ({ songId: x.songId, status: x.status, headlines: x.sources.slice(0, 2).map(s => s.title) })),
      recent: state.history.slice(0, 30).map(x => ({ songId: x.songId, artists: x.artists, action: x.action })),
      neteaseHistory: state.remoteHistory.slice(0, 20).map(compactSong), news,
    }, Math.min(65536, Math.max(32768, library.length * 24)), 'high');
    draft.brief = brief; checkpoint();
    signal.throwIfAborted();
    const byId = new Map(library.map(x => [x.id, x])); const seen = new Set(); const order = [];
    for (const id of Array.isArray(brief.order) ? brief.order : []) if (byId.has(String(id)) && !seen.has(String(id))) { seen.add(String(id)); order.push(byId.get(String(id))); }
    // An invalid or truncated model order can never omit a listener's songs.
    for (const song of library) if (!seen.has(song.id)) order.push(song);
    const supplements = draft.supplements;
    const queries = (Array.isArray(brief.researchQueries) ? brief.researchQueries : []).slice(0, 8);
    let completed = supplements.filter(Boolean).length;
    progress({ phase: '正在扩展查证编导提出的资料', done: completed, total: queries.length });
    for (let i = 0; i < queries.length; i += 2) {
      await Promise.all(queries.slice(i, i + 2).map(async (q, localIndex) => {
        const index = i + localIndex; signal.throwIfAborted(); if (supplements[index]) return;
        try {
          const sources = cleanText(q.query, 350) ? await this.research.query(q.query, signal) : [];
          supplements[index] = { query: cleanText(q.query, 350), sources, songId: String(q.songId || '') };
        } catch (error) { signal.throwIfAborted(); supplements[index] = { query: cleanText(q.query, 350), sources: [], error: cleanText(error.message, 160) }; }
        checkpoint(); progress({ done: ++completed, total: queries.length });
      }));
    }
    for (const entry of supplements.filter(Boolean)) if (facts.has(entry.songId)) {
      const item = facts.get(entry.songId); item.sources = [...new Map([...item.sources, ...entry.sources].map(x => [x.id, x])).values()];
    }
    const arc = (Array.isArray(brief.arc) ? brief.arc : []).slice(0, 8).map(x => ({ title: cleanText(x.title, 60), purpose: cleanText(x.purpose, 400) }));
    const segments = []; let opening = ''; let elapsed = 0; let newsIndex = 0; let nextNews = settings.newsMinutes * 60;
    const assignments = order.map((song, index) => {
      const newsSlot = elapsed >= nextNews && newsIndex < news.length ? news[newsIndex++] : null;
      if (newsSlot) nextNews += settings.newsMinutes * 60;
      elapsed += (song.interval || 180) + 20;
      return { song, index, newsSlot, humorSlot: settings.humorEvery > 0 && (index + 1) % settings.humorEvery === 0 && !newsSlot };
    });
    for (let offset = 0; offset < assignments.length; offset += CHAPTER_SIZE) {
      signal.throwIfAborted(); const group = assignments.slice(offset, offset + CHAPTER_SIZE);
      progress({ phase: '正在撰写逐首串场与完整节目稿', done: offset, total: order.length, detail: '' });
      let script = draft.chapters[offset];
      const payload = {
        stage: 'script', programmeTitle: cleanText(brief.title, 100), editorialNotes: cleanText(brief.editorialNotes, 1600), arc,
        time: context.localTime, weather: context.weather, listenerNotes: settings.extraContext,
        isFirstChapter: offset === 0, previousChapterEnding: segments.at(-1)?.speech?.intro || '',
        songs: group.map(({ song, index, newsSlot, humorSlot }) => ({
          ...compactSong(song), position: index + 1, previousSong: order[index - 1] ? compactSong(order[index - 1]) : null,
          nextSong: order[index + 1] ? compactSong(order[index + 1]) : null,
          sources: facts.get(song.id)?.sources || [], newsSlot, humorSlot,
        })),
      };
      if (!script) {
        script = await callJson(SCRIPT_PROMPT, payload, 24576, 'low');
        draft.chapters[offset] = script; checkpoint();
      }
      if (!offset) opening = cleanText(script.opening, 500);
      const lines = new Map(script.songs.map(x => [String(x.id), x]));
      for (const assignment of group) {
        const { song, index, newsSlot, humorSlot } = assignment; const line = lines.get(song.id) || {};
        const sources = facts.get(song.id)?.sources || [];
        const sourceIds = (Array.isArray(line.sourceIds) ? line.sourceIds : []).filter(id => sources.some(s => s.id === id));
        const intro = sourceIds.length ? cleanText(line.intro, 650) || safeIntro(song, order[index - 1]) : safeIntro(song, order[index - 1]);
        const newsText = newsSlot ? '据' + newsSlot.source + '今天报道，' + (cleanText(line.newsText, 250) || newsSlot.title + '。') : '';
        const joke = humorSlot ? cleanText(line.joke, 100) : '';
        const id = randomUUID();
        segments.push({ id, track: song, chapter: arc.length ? arc[Math.min(arc.length - 1, Math.floor(index / order.length * arc.length))].title : '',
          speech: { id: id + '-speech', type: newsSlot ? 'news' : joke ? 'joke' : 'segue', intro, newsText, text: [newsText, joke, intro].filter(Boolean).join(''), news: newsSlot, joke: !!joke, sourceIds },
          cue: { placement: 'before-track', bed: 'station', duck: settings.duckVolume },
        });
      }
      progress({ done: Math.min(order.length, offset + group.length), total: order.length, retryReason: '' });
    }
    if (!opening) opening = '听众朋友们，大家好！我是小鲸。现在是' + context.localTime + '，今天也一起认真听歌吧。';
    const p = {
      id: randomUUID(), signature, title: cleanText(brief.title, 100) || '小鲸的今日电台', editorialNotes: cleanText(brief.editorialNotes, 1800), arc,
      date: localDate(this.now(), settings.timezone), generatedAt: this.now(), mode: 'ai', host, context, segments,
      opening: { id: randomUUID(), type: 'opening', text: opening }, research, supplements: supplements.filter(Boolean), generation: draft.calls,
      researched: research.filter(x => x.sources.length).length, missingResearch: research.filter(x => !x.sources.length).length,
    };
    return this.calibrateAudio(p, { signal, progress, settings });
  }
  async calibrateAudio(p, { signal, progress, settings = this.store.state.settings }) {
    if (this.prepareAudio) await this.prepareAudio(p, { signal, progress });
    for (const speech of [p.opening, ...p.segments.map(x => x.speech)]) speech.duration ||= Math.max(1, speech.text.length / (4.2 * settings.tts.rate));
    p.timeline = programmeTimeline(p, settings);
    p.audioSignature = this.audioSignature(settings);
    p.article = this.article(p); signal.throwIfAborted(); return p;
  }
  article(p = this.current) {
    if (!p) return '';
    const parts = ['# ' + p.title, p.date, '## 编导说明', p.editorialNotes, ...p.arc.map(x => '### ' + x.title + '\n' + x.purpose), '## 开场 · 舒缓背景音乐', p.opening.text];
    for (const [i, segment] of p.segments.entries()) {
      const cue = p.timeline?.[i];
      parts.push('## ' + (i + 1) + '. ' + segment.track.title + ' — ' + segment.track.artists.join(' / '),
        cue ? '预计音乐进入 ' + cue.musicStart.toFixed(1) + ' 秒；口播 ' + cue.speechStart.toFixed(1) + '–' + cue.speechEnd.toFixed(1) + ' 秒。' + (i ? '先压低音乐，口播覆盖前曲尾奏与后曲前奏。' : '在背景乐上完成第一首介绍，随后进入歌曲。') : '', segment.speech.text);
    }
    const sources = new Map([...p.research.flatMap(x => x.sources), ...p.supplements.flatMap(x => x.sources)].map(x => [x.id, x]));
    parts.push('## 参考资料', ...[...sources.values()].map(x => '- [' + x.title + '](' + x.url + ')'));
    return parts.join('\n\n') + '\n';
  }
  async createBatch(request) {
    if (!this.current) {
      this.start({ query: request.query }); await this.preparing;
      if (!this.current) throw new Error(this.job.error || '节目尚未准备完成');
    }
    if (this.cursor >= this.current.segments.length) {
      if (this.nextProgramme) { this.current = this.nextProgramme; this.nextProgramme = null; this.store.state.programme = this.current; this.store.save(); }
      this.cursor = 0; this.round++;
    }
    const opening = request.opening && this.cursor === 0 && this.round === 0 ? this.current.opening : null;
    const blocked = new Set([...this.blocked].filter(([, expiry]) => expiry > this.now()).map(([id]) => id));
    const usedNews = this.store.state.spoken.filter(x => x.newsId).map(x => x.newsId);
    const segments = [];
    while (this.cursor < this.current.segments.length && segments.length < 4) {
      const original = this.current.segments[this.cursor++]; if (blocked.has(original.track.id)) continue;
      const segment = structuredClone(original); segment.id = randomUUID(); segment.speech.id = segment.id + '-speech';
      if (segment.speech.news && !freshNews([segment.speech.news], this.now(), this.store.state.settings.timezone, usedNews).length) {
        segment.speech.news = null; segment.speech.newsText = ''; segment.speech.text = segment.speech.intro;
      }
      segments.push(segment);
    }
    if (!segments.length) { const error = new Error('歌单中的歌曲暂时不可播放'); error.retryAfter = 30; throw error; }
    // Prepare the next edition in the background while the already scripted
    // edition continues. An outage loops that script without stale bulletins.
    if (this.cursor >= Math.max(1, this.current.segments.length - 8) && !this.renewal && this.now() - this.lastRenewAt > 5 * 60000) {
      this.lastRenewAt = this.now(); const epoch = this.epoch; const signal = this.abort?.signal || new AbortController().signal;
      this.renewal = this.build({ query: '', signature: this.signature(), signal, draftKey: 'renew-' + this.current.id }).then(p => { if (epoch === this.epoch) this.nextProgramme = p; }).catch(() => {}).finally(() => { this.renewal = null; });
    }
    return { id: randomUUID(), programmeId: this.current.id, programmeTitle: this.current.title, total: this.current.segments.length, opening, segments,
      context: { ...this.current.context, news: [] }, host: this.current.host, mode: 'ai', notice: this.current.missingResearch ? '部分歌曲未查到可靠背景，串场仅使用已知歌曲信息。' : '', generatedAt: this.current.generatedAt };
  }
}
