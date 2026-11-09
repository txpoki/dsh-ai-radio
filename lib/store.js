import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const HOSTS = [
  { id: 'whale', name: '小鲸', subtitle: '元气满满的鲸鱼少女，陪你认真听歌', style: '你是小鲸，一位充满元气的鲸鱼少女电台主持人。说话明亮、有好奇心，像懂音乐的朋友。可以偶尔开个与音乐有关的小玩笑，但不装幼稚、不喊主人、不堆叠语气词。认真介绍音乐，照顾听众的节奏。' },
  { id: 'night', name: '林间 · 夜航', subtitle: '温柔、克制，陪你慢下来', style: '温柔沉静的夜间音乐主播。口语短句，适度幽默，不煽情，不称呼主人。' },
  { id: 'day', name: '晴川 · 晨光', subtitle: '清爽、有活力，接住新一天', style: '清爽有活力的晨间主播。简洁自然，关心天气与一天的节奏，不说空洞鸡汤。' },
  { id: 'city', name: '阿岚 · 城市漫游', subtitle: '松弛、机智，音乐里聊几句', style: '松弛机智的城市音乐主播，有一点冷幽默。像熟悉音乐的朋友，避免夸张和套话。' },
];

export const DEFAULTS = {
  city: '上海', timezone: 'Asia/Shanghai', hostId: 'whale', selectedPlaylistIds: [], persona: '',
  crossfadeSeconds: 6, speechEvery: 2, newsMinutes: 30, humorEvery: 4,
  volume: 0.75, speechVolume: 1, duckVolume: 0.14, bedVolume: 0.32,
  interests: '科技、生活、文化', extraContext: '', customFeeds: [],
  llm: { mode: 'dsh', provider: '', model: '', baseUrl: '', apiKey: '' },
  tts: { provider: 'edge', voice: 'zh-CN-XiaoyiNeural', language: 'zh-CN', rate: 1.02, pitch: '+5Hz', baseUrl: '', model: '', apiKey: '', fishVoiceId: 'fe50cdf3040449298470d58ff0991e1d' },
};
export function cleanText(value, max = 500) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
function bounded(value, fallback, min, max) {
  const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
export function sanitizeSettings(input = {}, previous = DEFAULTS) {
  const out = structuredClone(previous);
  for (const key of ['city', 'timezone', 'interests', 'extraContext', 'persona']) {
    if (Object.hasOwn(input, key)) out[key] = cleanText(input[key], key === 'persona' ? 6000 : key === 'extraContext' ? 2000 : 200);
  }
  try { new Intl.DateTimeFormat('en', { timeZone: out.timezone }).format(); } catch { throw new Error('时区无效'); }
  if (input.hostId && HOSTS.some(h => h.id === input.hostId)) out.hostId = input.hostId;
  if (Array.isArray(input.selectedPlaylistIds)) out.selectedPlaylistIds = [...new Set(input.selectedPlaylistIds.map(String).filter(x => /^\d+$/.test(x)))].slice(0, 30);
  const bounds = { crossfadeSeconds: [0, 12], speechEvery: [1, 8], newsMinutes: [5, 120], humorEvery: [0, 12], volume: [0, 1], speechVolume: [0, 1], duckVolume: [0.03, 0.5], bedVolume: [0, 0.65] };
  for (const [key, [min, max]] of Object.entries(bounds)) if (Object.hasOwn(input, key)) out[key] = bounded(input[key], previous[key], min, max);
  if (Array.isArray(input.customFeeds)) out.customFeeds = input.customFeeds.slice(0, 12).map(x => ({ title: cleanText(x.title, 50), url: cleanText(x.url, 500) })).filter(x => x.url);
  for (const group of ['llm', 'tts']) {
    if (!input[group] || typeof input[group] !== 'object') continue;
    for (const key of Object.keys(DEFAULTS[group])) {
      if (!Object.hasOwn(input[group], key)) continue;
      if (key === 'rate') out[group][key] = bounded(input[group][key], previous[group][key], 0.7, 1.4);
      else if (key === 'apiKey') { if (input[group][key] !== '') out[group][key] = cleanText(input[group][key], 1000); }
      else out[group][key] = cleanText(input[group][key], 500);
    }
  }
  if (!['dsh', 'api'].includes(out.llm.mode)) throw new Error('AI 接入方式无效');
  if (!['edge', 'browser', 'openai', 'fish'].includes(out.tts.provider)) throw new Error('音色服务无效');
  if (input.clearLlmKey) out.llm.apiKey = '';
  if (input.clearTtsKey) out.tts.apiKey = '';
  return out;
}
export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.state = { schemaVersion: 2, settings: structuredClone(DEFAULTS), cookie: '', account: null, playlists: [], library: [], remoteHistory: [], history: [], spoken: [], playback: null, programme: null, programmeDraft: null, research: {} };
    try {
      const data = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'));
      this.state = { ...this.state, ...data, settings: sanitizeSettings({ ...data.settings, llm: { ...DEFAULTS.llm, ...data.settings?.llm }, tts: { ...DEFAULTS.tts, ...data.settings?.tts } }) };
      if (!data.schemaVersion || data.schemaVersion < 2) {
        this.state.settings.hostId = 'whale';
        if (this.state.settings.tts.provider === 'browser') Object.assign(this.state.settings.tts, { provider: 'edge', voice: 'zh-CN-XiaoyiNeural', pitch: '+5Hz', rate: 1.02 });
        this.state.schemaVersion = 2;
      }
    } catch (error) { if (error.code !== 'ENOENT') this.loadError = '本地状态无法读取，已使用默认设置'; }
  }
  save() {
    const file = join(this.directory, 'state.json');
    const temporary = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, file);
    try { chmodSync(file, 0o600); } catch { /* Windows ACLs are inherited. */ }
  }
  settings(input) { this.state.settings = sanitizeSettings(input, this.state.settings); this.save(); return this.publicSettings(); }
  publicSettings() {
    const value = structuredClone(this.state.settings);
    for (const name of ['llm', 'tts']) { value[name].hasKey = !!value[name].apiKey; delete value[name].apiKey; }
    return value;
  }
  event(input) {
    const id = cleanText(input.eventId, 100);
    if (!id) throw new Error('播放事件缺少唯一 ID');
    if (this.state.history.some(x => x.eventId === id)) return;
    const song = this.state.library.find(x => x.id === String(input.songId));
    if (!song) return;
    this.state.history.unshift({ eventId: id, songId: song.id, title: song.title, artists: song.artists, action: ['played', 'skipped', 'liked', 'failed'].includes(input.action) ? input.action : 'played', fraction: bounded(input.fraction, 0, 0, 1), at: Date.now() });
    this.state.history = this.state.history.slice(0, 2000);
    this.save();
  }
}
