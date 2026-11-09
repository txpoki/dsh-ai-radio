import { createHash } from 'node:crypto';
import { DEFAULT_RSS_FEEDS, parseRssXml, normalizeTitle, titlesDuplicate } from './vendor/news-core.js';
import { publicFetch, limitedText } from './network.js';
import { cleanText } from './store.js';

export function localDate(now, timezone) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); }
export function freshNews(items, now, timezone, used = []) {
  const today = localDate(now, timezone); const out = []; const usedSet = new Set(used);
  for (const item of items.sort((a,b) => b.publishedAt - a.publishedAt)) {
    if (!Number.isFinite(item.publishedAt) || item.publishedAt > now + 300000 || localDate(item.publishedAt, timezone) !== today || usedSet.has(item.id)) continue;
    const norm = normalizeTitle(item.title);
    if (out.some(x => titlesDuplicate(normalizeTitle(x.title), norm))) continue;
    out.push(item);
  }
  return out;
}
const weatherNames = code => code === 0 ? '晴' : code <= 3 ? '多云' : code <= 48 ? '有雾' : code <= 67 ? '有雨' : code <= 77 ? '有雪' : code <= 82 ? '阵雨' : code <= 86 ? '阵雪' : '雷雨';
export class Context {
  constructor(store, { fetchImpl = fetch, publicFetchImpl = publicFetch, now = Date.now } = {}) {
    this.store = store; this.fetch = fetchImpl; this.publicFetch = publicFetchImpl; this.now = now;
    this.newsCache = null; this.weatherCache = null; this.geo = new Map(); this.pendingNews = null;
  }
  async weather() {
    const city = this.store.state.settings.city; const now = this.now();
    if (!city) return null;
    if (this.weatherCache?.city === city && now - this.weatherCache.fetchedAt < 20 * 60000 && localDate(now, this.store.state.settings.timezone) === localDate(this.weatherCache.fetchedAt, this.store.state.settings.timezone)) return this.weatherCache;
    try {
      let geo = this.geo.get(city);
      if (!geo) {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.search = new URLSearchParams({ name: city, count: '1', language: 'zh', format: 'json' });
        const data = await (await this.fetch(url, { signal: AbortSignal.timeout(7000) })).json();
        geo = data.results?.[0]; if (!geo) throw new Error('没有找到该城市'); this.geo.set(city, geo);
      }
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: String(geo.latitude), longitude: String(geo.longitude), current: 'temperature_2m,weather_code,is_day', daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max', timezone: 'auto', forecast_days: '1' });
      const data = await (await this.fetch(url, { signal: AbortSignal.timeout(7000) })).json();
      if (!data.current || !data.daily) throw new Error('天气数据缺失');
      return this.weatherCache = { city, location: geo.name, temperature: data.current.temperature_2m, description: weatherNames(data.current.weather_code), high: data.daily.temperature_2m_max[0], low: data.daily.temperature_2m_min[0], rain: data.daily.precipitation_probability_max[0], fetchedAt: now, source: 'Open-Meteo' };
    } catch (error) { this.weatherError = cleanText(error.message, 100); return null; }
  }
  async news() {
    const { timezone, customFeeds } = this.store.state.settings;
    const key = JSON.stringify(customFeeds); const now = this.now();
    if (this.newsCache?.key === key && now - this.newsCache.fetchedAt < 10 * 60000) return freshNews(this.newsCache.items, now, timezone);
    if (this.pendingNews) return this.pendingNews;
    this.pendingNews = (async () => {
      const feeds = [...DEFAULT_RSS_FEEDS.filter(x => ['热点', '科技', '国内', '国际', '娱乐'].includes(x.category)).slice(0, 7), ...customFeeds.map((x,i) => ({ ...x, id: 'custom-' + i }))];
      const items = []; const errors = [];
      // Refresh at collection time. A source never claims to have news merely because its URL responds.
      for (let i = 0; i < feeds.length; i += 3) {
        const results = await Promise.allSettled(feeds.slice(i, i + 3).map(async feed => {
          const response = await this.publicFetch(feed.url, {}, { timeoutMs: 6500 });
          const xml = await limitedText(response);
          return parseRssXml(xml).slice(0, 50).map(item => ({ id: createHash('sha256').update(feed.id + item.link + item.title).digest('hex').slice(0, 20), title: cleanText(item.title, 160), summary: cleanText(item.description, 220), url: /^https?:\/\//.test(item.link) ? item.link : feed.url, source: feed.title, category: feed.category || '自选', publishedAt: Date.parse(item.pubDate) }));
        }));
        results.forEach((r,j) => r.status === 'fulfilled' ? items.push(...r.value) : errors.push(feeds[i+j].title));
      }
      this.newsCache = { key, fetchedAt: now, items: freshNews(items, now, timezone), errors };
      return this.newsCache.items;
    })().finally(() => { this.pendingNews = null; });
    return this.pendingNews;
  }
  async assemble() {
    const now = this.now(); const { timezone, interests, extraContext } = this.store.state.settings;
    const [weather, news] = await Promise.all([this.weather(), this.news()]);
    return { now, localTime: new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(now), weather, news, interests, extraContext, weatherError: this.weatherError || '', newsFailures: this.newsCache?.errors || [] };
  }
}
