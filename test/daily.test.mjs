import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { Music } from '../lib/music.js';

const folders = [];
const raw = (id = 1) => ({ id, name: '每日推荐测试 ' + id, ar: [{ name: '测试歌手' }], al: { name: '测试专辑' }, dt: 180000 });
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function fixture(fetchImpl) {
  const directory = mkdtempSync(join(tmpdir(), 'daily-radio-')); folders.push(directory);
  const store = new Store(directory);
  Object.assign(store.state, { cookie: 'MUSIC_U=test-cookie; __csrf=test-csrf', account: { userId: 'test-user' } });
  return { store, music: new Music(store, {}, fetchImpl) };
}
test.after(() => { for (const directory of folders) rmSync(directory, { recursive: true, force: true }); });

test('daily recommendations use the authenticated NetEase endpoint and preserve the selected library', async () => {
  let request;
  const { store, music } = fixture(async (url, options) => { request = { url, ...options }; return response({ code: 200, data: { dailySongs: [raw(), raw(), raw(2), { id: 'bad', name: 'invalid' }] } }); });
  store.state.library = [{ id: 'old' }];
  const daily = await music.getDailyRecommendations();
  assert.equal(daily.songs.length, 2); assert.deepEqual(daily.songs[0].artists, ['测试歌手']); assert.equal(daily.songs[0].interval, 180);
  assert.equal(request.url, 'https://music.163.com/weapi/v3/discovery/recommend/songs');
  assert.equal(request.headers.Cookie, store.state.cookie); assert.ok(request.body.has('params') && request.body.has('encSecKey'));
  assert.equal(store.state.library[0].id, 'old'); assert.equal(store.state.librarySource, null);
});
test('daily cache uses the Shanghai date, refreshes explicitly and renews on a new day', async () => {
  let requests = 0;
  const { music } = fixture(async () => { requests++; return response({ code: 200, data: { dailySongs: [raw()] } }); });
  let clock = Date.parse('2026-11-09T15:59:00Z'); music.now = () => clock;
  assert.equal((await music.getDailyRecommendations()).date, '2026-11-09');
  await music.getDailyRecommendations(); assert.equal(requests, 1);
  await music.getDailyRecommendations({ refresh: true }); assert.equal(requests, 2);
  clock += 120000;
  assert.equal((await music.getDailyRecommendations()).date, '2026-11-10'); assert.equal(requests, 3);
});
test('daily recommendations can become the radio source and playlists can be restored afterward', async () => {
  const { store, music } = fixture(async () => response({ code: 200, recommend: [{ id: 7, name: '旧格式', artists: [{ name: '测试歌手' }], album: { name: '专辑' }, duration: 220000 }] }));
  store.state.settings.selectedPlaylistIds = ['99'];
  const result = await music.loadDailyRecommendations();
  assert.equal(result.count, 1); assert.equal(store.state.librarySource.type, 'daily'); assert.equal(store.state.library[0].interval, 220);
  assert.deepEqual(store.state.settings.selectedPlaylistIds, ['99']);
  music.api.getPlaylistSongs = async () => ({ name: '原歌单', songs: [{ id: '1', title: '歌单音乐' }] });
  await music.loadLibrary(['99']); assert.equal(store.state.librarySource.type, 'playlists'); assert.equal(store.state.library[0].id, '1');
});
test('login expiry and an empty daily response are explicit and cannot replace the library', async () => {
  let body = { code: 301 };
  const { store, music } = fixture(async () => response(body)); store.state.library = [{ id: 'keep' }];
  await assert.rejects(() => music.loadDailyRecommendations(), /登录已过期/);
  body = { code: 200, data: { dailySongs: [] } };
  await assert.rejects(() => music.loadDailyRecommendations(), /暂时没有/);
  assert.equal(store.state.library[0].id, 'keep'); assert.equal(store.state.dailyRecommendations, null);
  store.state.cookie = ''; await assert.rejects(() => music.getDailyRecommendations(), /先登录/);
});
test('an in-flight daily response cannot resurrect an account after logout', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { store, music } = fixture(async () => { await gate; return response({ code: 200, data: { dailySongs: [raw()] } }); });
  const pending = music.getDailyRecommendations();
  music.logout(); release();
  await assert.rejects(() => pending, /账号已切换/);
  assert.equal(store.state.dailyRecommendations, null); assert.equal(store.state.librarySource, null); assert.equal(store.state.library.length, 0);
});
test('simultaneous daily reads share one upstream request', async () => {
  let requests = 0;
  const { music } = fixture(async () => { requests++; return response({ code: 200, data: { dailySongs: [raw()] } }); });
  const results = await Promise.all([music.getDailyRecommendations(), music.getDailyRecommendations()]);
  assert.equal(requests, 1); assert.deepEqual(results[0], results[1]);
});
