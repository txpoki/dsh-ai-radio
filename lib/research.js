import { createHash } from 'node:crypto';
import { publicFetch, limitedText } from './network.js';
import { parseRssXml } from './vendor/news-core.js';
import { cleanText } from './store.js';

export class MusicResearch {
  constructor(store, { getWeb = () => null, search, publicFetchImpl = publicFetch, now = Date.now } = {}) {
    this.store = store; this.getWeb = getWeb; this.searchImpl = search; this.fetch = publicFetchImpl; this.now = now;
  }
  async search(query, signal) {
    signal?.throwIfAborted();
    if (this.searchImpl) return this.searchImpl(query, signal);
    const web = this.getWeb();
    if (web?.search) {
      try {
        const result = await web.search({ query, maxResults: 4 }, signal);
        if (result.sources?.length) return result.sources.map(x => ({ title: x.title, url: x.url, summary: x.snippet || x.description || x.summary || '', source: x.siteName || x.source || '' }));
      } catch (error) {
        signal?.throwIfAborted();
        if (!/WEB_PROVIDER_(UNAVAILABLE|CONFIGURED_MISSING|CONFIGURED_UNAVAILABLE|CREDENTIAL_MISSING|AMBIGUOUS)/.test(error.code || '')) throw error;
      }
    }
    const url = new URL('https://www.bing.com/search');
    url.search = new URLSearchParams({ q: query, format: 'rss', setlang: 'zh-CN' });
    const response = await this.fetch(url, { signal }, { timeoutMs: 15000 });
    return parseRssXml(await limitedText(response, 500000)).slice(0, 4).map(x => ({ title: x.title, url: x.link, summary: x.description, source: 'Bing 网页搜索' }));
  }
  async query(query, signal) {
    const results = await this.search(cleanText(query, 350), signal);
    return (Array.isArray(results) ? results : []).filter(x => {
      try { return ['https:', 'http:'].includes(new URL(x.url).protocol); } catch { return false; }
    }).slice(0, 4).map(x => ({
      id: 'src-' + createHash('sha256').update(x.url + (x.title || '')).digest('hex').slice(0, 16),
      title: cleanText(x.title, 160), url: x.url, summary: cleanText(x.summary || x.snippet, 550), source: cleanText(x.source, 80),
      retrievedAt: this.now(),
    }));
  }
  async song(song, signal) {
    const key = createHash('sha256').update(JSON.stringify([song.id, song.title, song.artists, song.album])).digest('hex');
    const cached = this.store.state.research?.[key];
    if (cached && this.now() - cached.at < 30 * 86400000 && cached.sources?.length) return { ...cached, cached: true };
    const query = '《' + song.title + '》 ' + (song.artists || []).join(' ') + ' ' + (song.album || '') + ' 歌曲创作背景 歌手 官方 访谈';
    try {
      const sources = await this.query(query, signal);
      const result = { songId: song.id, query, sources, at: this.now(), status: sources.length ? 'searched' : 'unavailable' };
      this.store.state.research ||= {}; this.store.state.research[key] = result;
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      return { songId: song.id, query, sources: [], at: this.now(), status: 'unavailable', error: cleanText(error.message, 160) };
    }
  }
  async all(songs, { signal, onProgress = () => {} } = {}) {
    const results = new Array(songs.length); let cursor = 0; let done = 0;
    const worker = async () => {
      while (cursor < songs.length) {
        signal?.throwIfAborted(); const index = cursor++;
        results[index] = await this.song(songs[index], signal);
        onProgress(++done, songs.length, songs[index].title);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, songs.length) }, worker));
    // Keep results for the selected library plus a bounded reuse cache.
    const cache = Object.entries(this.store.state.research || {}).sort((a,b) => b[1].at - a[1].at);
    this.store.state.research = Object.fromEntries(cache.slice(0, Math.max(2000, songs.length)));
    this.store.save(); return results;
  }
}
