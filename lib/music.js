import * as netease from './vendor/netease.js';

export class Music {
  constructor(store, api = netease, fetchImpl = fetch) { this.store = store; this.api = api; this.fetch = fetchImpl; this.urls = new Map(); }
  async qr() { return this.api.createQRLogin(); }
  async poll(key) {
    const result = await this.api.checkQRLogin(key);
    if (result.status === 'success' && result.cookie) await this.login(result.cookie);
    return { status: result.status, message: result.message, account: this.store.state.account };
  }
  async login(cookie) {
    const account = await this.api.getAccount(cookie);
    if (!account) throw new Error('网易云登录态无效，请重新登录');
    this.store.state.cookie = cookie;
    this.store.state.account = { userId: String(account.userId), nickname: account.nickname, vipType: account.vipType };
    // Never carry another listener's library or taste over an account switch.
    if (this.store.state.libraryOwner !== String(account.userId)) {
      Object.assign(this.store.state, { libraryOwner: String(account.userId), library: [], playlists: [], history: [], remoteHistory: [], spoken: [], playback: null, programme: null });
      this.store.state.settings.selectedPlaylistIds = [];
    }
    this.urls.clear(); this.store.save();
    return this.syncPlaylists();
  }
  logout() {
    Object.assign(this.store.state, { cookie: '', account: null, library: [], playlists: [], remoteHistory: [], history: [], spoken: [], playback: null, programme: null, libraryOwner: '' });
    this.store.state.settings.selectedPlaylistIds = [];
    this.urls.clear(); this.store.save();
  }
  async syncPlaylists() {
    const list = []; const seen = new Set();
    for (let page = 1; page <= 20; page++) {
      const batch = await this.api.getMyPlaylists(this.store.state.cookie, page, 100);
      const added = batch.filter(p => !seen.has(p.id));
      for (const item of added) { seen.add(item.id); list.push(item); }
      if (batch.length < 100 || !added.length) break;
    }
    this.store.state.playlists = list; this.store.save();
    this.syncRemoteHistory().catch(() => {});
    return list;
  }
  async syncRemoteHistory() {
    const userId = this.store.state.account?.userId;
    if (!userId) return [];
    const response = await this.fetch('https://music.163.com/weapi/v1/play/record', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/', Cookie: this.store.state.cookie },
      body: new URLSearchParams(netease.weapi({ uid: userId, type: 1, csrf_token: netease.cookieValue(this.store.state.cookie, '__csrf') })),
    });
    const data = await response.json();
    if (data.code !== 200) return [];
    const history = (data.weekData || data.allData || []).slice(0, 100).map(x => ({ ...netease.normalizeSong(x.song), playCount: x.playCount || 0 }));
    this.store.state.remoteHistory = history; this.store.save(); return history;
  }
  async loadLibrary(ids) {
    const cookie = this.store.state.cookie;
    if (!cookie) throw new Error('请先登录网易云');
    const selected = ids?.length ? ids : this.store.state.settings.selectedPlaylistIds;
    if (!selected.length) throw new Error('请先选择至少一个歌单');
    const tracks = new Map(); const failures = [];
    // Two upstream requests at once, avoiding unbounded fan-out on large accounts.
    for (let i = 0; i < selected.length; i += 2) {
      const results = await Promise.allSettled(selected.slice(i, i + 2).map(id => this.api.getPlaylistSongs(id, cookie)));
      for (const result of results) {
        if (result.status !== 'fulfilled') { failures.push(result.reason.message); continue; }
        for (const song of result.value.songs) {
          const previous = tracks.get(song.id);
          tracks.set(song.id, { ...song, playlistNames: [...new Set([...(previous?.playlistNames || []), result.value.name])] });
        }
      }
    }
    if (!tracks.size) throw new Error(failures[0] || '所选歌单中没有可读取的歌曲');
    this.store.state.library = [...tracks.values()];
    this.store.state.settings.selectedPlaylistIds = selected;
    this.store.state.librarySyncedAt = Date.now(); this.store.save();
    return { count: tracks.size, failures };
  }
  async stream(songId, refresh = false) {
    if (!this.store.state.library.some(s => s.id === String(songId))) throw new Error('歌曲不在已选歌单中');
    const cached = this.urls.get(String(songId));
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached;
    // The v1 endpoint uses the listener's real cookie and entitlement. Never unlock or change sources.
    let result;
    try {
      const response = await this.fetch('https://music.163.com/weapi/song/enhance/player/url/v1', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/', Cookie: this.store.state.cookie },
        body: new URLSearchParams(netease.weapi({ ids: JSON.stringify([Number(songId)]), level: 'exhigh', encodeType: 'aac', csrf_token: netease.cookieValue(this.store.state.cookie, '__csrf') })),
      });
      const json = await response.json(); const data = json.data?.[0];
      if (json.code === 200 && data?.url) result = data;
    } catch { /* fallback to the upstream adapter with the same account */ }
    if (!result) result = await this.api.getDownloadURL(songId, this.store.state.cookie);
    if (!result.url || result.freeTrialInfo) throw new Error(result.freeTrialInfo ? '这首歌仅返回试听，已跳过' : '这首歌当前不可播放，已跳过');
    result = { ...result, expiresAt: Date.now() + 120000 };
    this.urls.set(String(songId), result); return result;
  }
}
