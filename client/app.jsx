import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './engine.js';
import { WHALE_PERSONA } from '../lib/prompts.js';

const STATUS = { idle: '尚未播放', preparing: '小鲸正在准备节目', hosting: '小鲸正在主持', playing: '正在播放', paused: '已暂停', retrying: '正在重连' };
const time = value => Math.floor((value || 0) / 60) + ':' + String(Math.floor((value || 0) % 60)).padStart(2, '0');
export function Icon({ name, size = 20 }) {
  const paths = {
    play: <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>,
    pause: <path d="M8 5v14M16 5v14" strokeWidth="4"/>,
    next: <><path d="m5 5 10 7-10 7Z" fill="currentColor" stroke="none"/><path d="M19 5v14" strokeWidth="3"/></>,
    radio: <><rect x="3" y="8" width="18" height="13" rx="3"/><path d="m5 8 13-5M6 13h3m-3 4h3"/><circle cx="16" cy="15" r="3"/></>,
    settings: <><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="5"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/></>,
    volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
    refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h3"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.radio}</svg>;
}
function Button({ children, icon, primary = false, className = '', ...props }) {
  return <button className={'ar-button ' + (primary ? 'primary ' : '') + className} {...props}>{icon && <Icon name={icon} size={18}/>} {children}</button>;
}
function Cover({ song, small = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [song?.cover]);
  return <div className={'ar-cover ' + (small ? 'small' : '')}>
    {!failed && /^https:\/\//.test(song?.cover || '') ? <img src={song.cover} referrerPolicy="no-referrer" alt="" onError={() => setFailed(true)}/> : <Icon name="radio" size={small ? 24 : 42}/>}
  </div>;
}
export function App({ controller, standalone = false, miniOnly = false, panelOnly = false }) {
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const open = page => controller.emit({ expanded: true, page });
  if (panelOnly && !s.expanded) return null;
  if (s.loading) return <div className="ar-root"><p className="ar-muted">正在连接电台…</p></div>;
  if (!s.settings) return <div className="ar-root ar-connection"><Button onClick={() => controller.init()}>重新连接电台</Button><p>{s.notice}</p></div>;
  const active = ['playing', 'hosting', 'preparing'].includes(s.status);
  const shown = !miniOnly && (standalone || s.expanded);
  return <div className={'ar-root ' + (standalone ? 'ar-standalone' : '')}>
    {!standalone && !panelOnly && <div className="ar-mini">
      <button className="ar-mini-brand" onClick={() => open('radio')}><Icon name="radio" size={17}/><span>小鲸电台</span></button>
      <span className="ar-mini-title">{s.speech ? '小鲸正在主持' : s.track ? s.track.title + ' · ' + s.track.artists.join(' / ') : STATUS[s.status]}</span>
      <button className="ar-icon-button" aria-label={active ? '暂停电台' : '播放电台'} onClick={() => active ? controller.pause() : controller.play()}><Icon name={active ? 'pause' : 'play'} size={18}/></button>
      <button className="ar-icon-button" aria-label="打开电台设置" onClick={() => open('settings')}><Icon name="settings" size={18}/></button>
    </div>}
    {shown && <div className={standalone ? 'ar-app' : 'ar-backdrop'} onClick={event => { if (event.target === event.currentTarget && !standalone) controller.emit({ expanded: false }); }}>
      <div className="ar-window" role={standalone ? undefined : 'dialog'} aria-label="小鲸电台" aria-modal={standalone ? undefined : true}>
        <header className="ar-header"><h1><Icon name="radio"/>小鲸电台</h1><div>{s.demo && <span className="ar-demo-badge">演示</span>}{!standalone && <button className="ar-icon-button" aria-label="收起电台" onClick={() => controller.emit({ expanded: false })}><Icon name="close"/></button>}</div></header>
        <nav className="ar-tabs" aria-label="电台导航">{[['radio', '正在收听'], ['library', '我的歌单'], ['settings', '设置']].map(([page, label]) =>
          <button key={page} aria-current={s.page === page ? 'page' : undefined} className={s.page === page ? 'selected' : ''} onClick={() => open(page)}>{label}</button>)}</nav>
        <main className="ar-content">
          {s.page === 'radio' && <RadioPage controller={controller} state={s}/>}
          {s.page === 'library' && <LibraryPage controller={controller} state={s}/>}
          {s.page === 'settings' && <SettingsPage controller={controller} state={s}/>}
        </main>
        {s.notice && <div className="ar-notice" role="status"><span>{s.notice}</span><button className="ar-icon-button" aria-label="关闭提示" onClick={() => controller.emit({ notice: '' })}><Icon name="close" size={16}/></button></div>}
      </div>
    </div>}
  </div>;
}
function RadioPage({ controller, state: s }) {
  const active = ['playing', 'hosting', 'preparing'].includes(s.status), busy = s.status === 'preparing';
  const song = s.track || s.upcomingTrack;
  const p = s.programmeStatus;
  return <section className="ar-radio-page">
    <div className="ar-page-heading"><h2>{s.programmeTitle || p?.programme?.title || '今天，听些什么？'}</h2><p>{busy ? '小鲸会先准备好整期节目，再陪你开台。' : '主持人 小鲸 · 元气鲸鱼少女'}</p></div>
    {busy && <div className="ar-preparation" role="status"><span className="ar-spinner"/><div><strong>{p?.phase || '正在准备今天的节目'}</strong><p>{p?.total > 0 ? p.done + ' / ' + p.total : ''}{p?.detail ? ' · ' + p.detail : ''}</p>
      {p?.model && <p>{p.model.phase === 'thinking' ? '模型正在思考' : p.model.phase === 'writing' ? '模型正在写稿' : p.model.phase === 'finished' ? '正在保存稿件' : '正在连接主持模型'}{p.model.textChars ? ' · 已输出 ' + p.model.textChars + ' 字' : ''}{p.model.attempt > 1 ? ' · 第 ' + p.model.attempt + ' 次尝试' : ''}</p>}
      {p?.elapsedMs > 0 && <p>已准备 {Math.floor(p.elapsedMs / 60000)} 分 {Math.floor(p.elapsedMs / 1000) % 60} 秒 · 已完成的章节会保留</p>}
    </div><button className="ar-text-button" onClick={() => controller.stop()}>取消</button></div>}
    <div className="ar-player">
      <Cover song={song}/>
      <div className="ar-player-body">
        <span className={'ar-state ' + (active ? 'active' : '')}><i/>{STATUS[s.status]}</span>
        <h3>{song?.title || '从你的歌单开始'}</h3>
        <p className="ar-artist">{song?.artists.join(' / ') || (s.libraryCount ? busy ? '背景音乐先陪你一会儿，小鲸正在准备今天的节目。' : '歌单已就绪，点击开始今日电台。' : '先去「我的歌单」，选择今天想听的音乐。')}</p>
        <p className="ar-album">{song?.album || '\u00a0'}</p>
        <div className="ar-progress" aria-label="歌曲进度"><div><i style={{ width: Math.min(100, s.position / Math.max(1, s.duration) * 100) + '%' }}/></div><span>{time(s.position)}<span>{time(s.duration)}</span></span></div>
        <div className="ar-controls">
          <Button primary data-testid="play" icon={active ? 'pause' : 'play'} aria-label={active ? '暂停电台' : '播放电台'} onClick={() => active ? controller.pause() : controller.play()}>{active ? '暂停' : s.status === 'paused' ? '继续播放' : '开始今日电台'}</Button>
          <button className="ar-icon-button" aria-label="下一首" disabled={!s.track && !s.speech} onClick={() => controller.next()}><Icon name="next"/></button>
          <label className="ar-volume"><Icon name="volume" size={17}/><input aria-label="播放音量" type="range" min="0" max="1" step=".05" value={s.settings.volume} onChange={e => { const volume = Number(e.target.value); controller.emit({ settings: { ...s.settings, volume } }); if (controller.master) controller.master.gain.value = volume; }} onPointerUp={e => controller.saveSettings({ volume: Number(e.target.value) }).catch(() => {})} onKeyUp={e => controller.saveSettings({ volume: Number(e.target.value) }).catch(() => {})}/></label>
        </div>
      </div>
    </div>
    {s.speech && <div className="ar-on-mic" aria-live="polite"><span className="ar-mic-name"><Icon name="volume" size={16}/>小鲸</span><p>{s.speech.text}</p></div>}
    {!!s.queue?.length && <div className="ar-next"><span>接下来</span><strong>{s.queue[0].track.title}</strong><span>{s.queue[0].track.artists.join(' / ')}</span></div>}
    {!s.libraryCount && <Button onClick={() => controller.emit({ page: 'library' })} icon="list">选择我的歌单</Button>}
  </section>;
}
function LibraryPage({ controller, state: s }) {
  const [selected, setSelected] = useState(s.settings.selectedPlaylistIds), [qr, setQr] = useState(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [cookie, setCookie] = useState('');
  const [daily, setDaily] = useState(null), [dailyError, setDailyError] = useState(''), [dailyLoading, setDailyLoading] = useState(false);
  useEffect(() => {
    let current = true; setDaily(null); setDailyError('');
    if (!s.account) return;
    setDailyLoading(true);
    api('/recommendations/daily').then(data => { if (current) setDaily(data); }).catch(error => { if (current) setDailyError(error.message); }).finally(() => { if (current) setDailyLoading(false); });
    return () => { current = false; };
  }, [s.account?.userId]);
  useEffect(() => setSelected(s.settings.selectedPlaylistIds), [s.librarySyncedAt]);
  useEffect(() => {
    if (!qr) return; let disposed = false, timer;
    const poll = async () => {
      try {
        const result = await api('/login/poll', { key: qr.key }); if (disposed) return; setMessage(result.message);
        if (result.status === 'success') { setQr(null); await controller.refresh(); return; }
        if (result.status === 'expired') { setQr(null); return; }
      } catch (error) { if (!disposed) setMessage(error.message); }
      if (!disposed) timer = setTimeout(poll, 2200);
    };
    timer = setTimeout(poll, 2000); return () => { disposed = true; clearTimeout(timer); };
  }, [qr]);
  const run = async fn => { setBusy(true); try { await fn(); } catch (error) { controller.emit({ notice: error.message }); } finally { setBusy(false); } };
  const start = ids => { controller.unlock(); run(() => controller.startFromPlaylists(ids)); };
  return <section>
    <div className="ar-page-heading ar-row"><div><h2>我的歌单</h2><p>{s.account ? s.account.nickname + ' · ' + s.playlists.length + ' 个歌单' : '连接网易云音乐，选择今天想听的歌。'}</p></div>{s.account && <Button icon="refresh" disabled={busy} onClick={() => run(async () => { await api('/playlists?refresh'); await controller.refresh(); })}>同步</Button>}</div>
    {!s.account ? <div className="ar-connect">
      {qr ? <><img className="ar-qr" src={qr.imageDataUrl} alt="网易云登录二维码"/><p>{message || '使用网易云音乐 App 扫码，并在手机上确认。'}</p></> : <><Icon name="radio" size={36}/><p>用网易云音乐 App 扫码登录</p><Button primary disabled={busy} onClick={() => run(async () => { setQr(await api('/login/qr', {})); setMessage(''); })}>连接网易云</Button></>}
      <details className="ar-details"><summary>使用已有登录 Cookie</summary><textarea aria-label="网易云 Cookie" value={cookie} onChange={e => setCookie(e.target.value)} placeholder="仅保存在本机"/><Button disabled={busy || !cookie} onClick={() => run(async () => { await api('/login/cookie', { cookie }); setCookie(''); await controller.refresh(); })}>验证并连接</Button></details>
    </div> : <>
      <article className={'ar-daily' + (s.librarySource?.type === 'daily' ? ' chosen' : '')} aria-label="网易云每日推荐">
        <div className="ar-daily-info"><span className="ar-daily-icon"><Icon name="calendar" size={25}/></span><div><strong>每日推荐</strong><p>{dailyLoading ? '正在读取今天的推荐…' : dailyError || (daily ? daily.count + ' 首 · ' + daily.date : '根据你的网易云听歌偏好推荐')}</p></div></div>
        <div className="ar-daily-actions"><button className="ar-icon-button" aria-label="刷新每日推荐" disabled={busy || dailyLoading} onClick={() => run(async () => { setDailyLoading(true); setDailyError(''); try { setDaily(await api('/recommendations/daily?refresh')); } catch (error) { setDailyError(error.message); } finally { setDailyLoading(false); } })}><Icon name="refresh" size={17}/></button><Button primary disabled={busy || dailyLoading || !daily || !!dailyError} onClick={() => { controller.unlock(); run(() => controller.startFromDaily()); }}>从每日推荐开始今日电台</Button></div>
      </article>
      <div className="ar-playlist-toolbar"><span>已选 {selected.length} 个歌单</span><Button primary disabled={busy || !selected.length} onClick={() => start(selected)}>{busy ? '正在准备…' : '从所选歌单开始今日电台'}</Button></div>
      <div className="ar-playlists">{s.playlists.map(p => <article className={'ar-playlist ' + (selected.includes(p.id) ? 'chosen' : '')} key={p.id}>
        <label><input type="checkbox" aria-label={'选择歌单 ' + p.name} checked={selected.includes(p.id)} onChange={() => setSelected(xs => xs.includes(p.id) ? xs.filter(x => x !== p.id) : [...xs, p.id])}/><Cover song={{ cover: p.cover }} small/><span><strong>{p.name}</strong><small>{p.trackCount} 首 · {p.creator}</small></span></label>
        <Button disabled={busy} onClick={() => start([p.id])}>从这个歌单开始今日电台</Button>
      </article>)}</div>
      <div className="ar-account-actions"><span>按账号实际收听权限播放</span><button className="ar-text-button" onClick={() => run(async () => { controller.stop(); await api('/logout', {}); await controller.refresh(); })}>退出登录</button></div>
    </>}
  </section>;
}
function Field({ label, help, children }) {
  return <label className="ar-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}
function SettingsPage({ controller, state: s }) {
  const [form, setForm] = useState(() => structuredClone(s.settings)), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [voices, setVoices] = useState([]);
  const [feeds, setFeeds] = useState(s.settings.customFeeds.map(x => x.title + '|' + x.url).join('\n'));
  useEffect(() => {
    const update = () => setVoices(window.speechSynthesis?.getVoices() || []); update();
    window.speechSynthesis?.addEventListener('voiceschanged', update); return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
  }, []);
  const change = (key, value) => { setSaved(false); setForm(f => ({ ...f, [key]: value })); };
  const nested = (group, key, value) => { setSaved(false); setForm(f => ({ ...f, [group]: { ...f[group], [key]: value } })); };
  const provider = value => {
    setSaved(false); setForm(f => ({ ...f, tts: { ...f.tts, provider: value, baseUrl: '', model: value === 'fish' ? s.dafeiyuVoice.model : value === 'openai' ? 'tts-1' : '', voice: value === 'edge' ? 'zh-CN-XiaoyiNeural' : value === 'openai' ? 'nova' : '', fishVoiceId: s.dafeiyuVoice.id } }));
  };
  const save = async () => {
    const customFeeds = feeds.split('\n').filter(x => x.trim()).map((row, i) => { const [title, ...url] = row.split('|'); return url.length ? { title: title.trim(), url: url.join('|').trim() } : { title: '自选源 ' + (i + 1), url: title.trim() }; });
    await controller.saveSettings({ ...form, customFeeds }); setSaved(true);
  };
  const run = async fn => { setBusy(true); try { await fn(); } catch (error) { controller.emit({ notice: error.message }); } finally { setBusy(false); } };
  return <section>
    <div className="ar-page-heading ar-row"><div><h2>设置</h2><p>音色、主持风格和音乐节奏</p></div><Button primary data-testid="save-settings" disabled={busy} onClick={() => run(save)}>{saved ? '已保存' : '保存设置'}</Button></div>
    <section className="ar-settings-section"><h3>主持音色</h3><div className="ar-form-grid">
      <Field label="语音服务"><select value={form.tts.provider} onChange={e => provider(e.target.value)}><option value="edge">自然少女声 · 无需密钥</option><option value="fish">大肥鱼 · Fish Audio</option><option value="openai">其他兼容语音服务</option><option value="browser">系统语音 · 兼容模式</option></select></Field>
      <Field label="音色">
        {form.tts.provider === 'edge' ? <select aria-label="主持人音色" value={form.tts.voice} onChange={e => nested('tts', 'voice', e.target.value)}>{s.edgeVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          : form.tts.provider === 'browser' ? <select value={form.tts.voice} onChange={e => nested('tts', 'voice', e.target.value)}><option value="">自动选择中文声音</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}</select>
          : form.tts.provider === 'fish' ? <input aria-label="Fish 音色 ID" value={form.tts.fishVoiceId} onChange={e => nested('tts', 'fishVoiceId', e.target.value)}/>
          : <input list="ar-voices" value={form.tts.voice} onChange={e => nested('tts', 'voice', e.target.value)}/>}
        <datalist id="ar-voices">{s.voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</datalist>
      </Field>
      <Field label={'语速 · ' + form.tts.rate.toFixed(2) + '×'}><input aria-label="主持语速" type="range" min=".7" max="1.4" step=".05" value={form.tts.rate} onChange={e => nested('tts', 'rate', Number(e.target.value))}/></Field>
      <Field label="试听"><Button disabled={busy} icon="play" onClick={() => { controller.unlock(); run(async () => { await save(); await controller.previewVoice(); }); }}>听听小鲸的声音</Button></Field>
      {['fish', 'openai'].includes(form.tts.provider) && <><Field label="语音 API Key" help={s.settings.tts.hasKey ? '已保存，留空保留原密钥' : '仅保存在本机'}><input type="password" autoComplete="new-password" value={form.tts.apiKey || ''} onChange={e => nested('tts', 'apiKey', e.target.value)}/></Field><Field label="语音模型"><input value={form.tts.model} onChange={e => nested('tts', 'model', e.target.value)}/></Field></>}
    </div><p className="ar-help">{form.tts.provider === 'fish' ? <>已预设社区「蓝色大肥鱼」音色，需要你自己的 Fish Audio Key。<a href={s.dafeiyuVoice.source} target="_blank" rel="noreferrer">查看来源</a></> : form.tts.provider === 'edge' ? '使用微软在线神经网络音色，口播文本会发送至微软。' : '选择喜欢的声音后可直接试听。'}</p>
    {['fish', 'openai'].includes(form.tts.provider) && <details className="ar-details"><summary>自定义语音接口</summary><Field label="接口地址"><input value={form.tts.baseUrl} onChange={e => nested('tts', 'baseUrl', e.target.value)} placeholder={form.tts.provider === 'fish' ? 'https://api.fish.audio' : 'https://api.openai.com/v1'}/></Field></details>}</section>
    <section className="ar-settings-section"><h3>声音与音乐</h3><div className="ar-form-grid">
      {[['duckVolume', '口播时音乐保留', .03, .5], ['speechVolume', '主持人音量', 0, 1], ['bedVolume', '开场背景音乐音量', 0, .65]].map(([key, label, min, max]) => <Field key={key} label={label + ' · ' + Math.round(form[key] * 100) + '%'}><input aria-label={label} type="range" min={min} max={max} step=".01" value={form[key]} onChange={e => change(key, Number(e.target.value))}/></Field>)}
      <Field label={'尾奏衔接 · ' + form.crossfadeSeconds + ' 秒'}><input type="range" min="0" max="12" step="1" value={form.crossfadeSeconds} onChange={e => change('crossfadeSeconds', Number(e.target.value))}/></Field>
    </div></section>
    <details className="ar-settings-section ar-details"><summary>主持人设</summary><p className="ar-help">默认是元气、懂音乐的鲸鱼少女小鲸。整期节目都会遵循这份人设。</p><textarea className="ar-persona" aria-label="主持人设提示词" value={form.persona || WHALE_PERSONA} onChange={e => change('persona', e.target.value)}/></details>
    <details className="ar-settings-section ar-details"><summary>节目内容与天气</summary><div className="ar-form-grid">
      <Field label="天气城市"><input value={form.city} onChange={e => change('city', e.target.value)}/></Field><Field label="时区"><input value={form.timezone} onChange={e => change('timezone', e.target.value)}/></Field>
      <Field label="关注话题"><input value={form.interests} onChange={e => change('interests', e.target.value)}/></Field><Field label="新闻间隔（分钟）"><input type="number" min="5" max="120" value={form.newsMinutes} onChange={e => change('newsMinutes', Number(e.target.value))}/></Field>
      <Field label="轻松一刻间隔（首歌，0 关闭）"><input type="number" min="0" max="12" value={form.humorEvery} onChange={e => change('humorEvery', Number(e.target.value))}/></Field>
      <Field label="给小鲸的补充信息"><textarea value={form.extraContext} onChange={e => change('extraContext', e.target.value)} placeholder="今天在写代码，想多听舒缓的歌。"/></Field>
    </div><Field label="自定义新闻 RSS" help="每行一个：名称|https://新闻源地址"><textarea value={feeds} onChange={e => setFeeds(e.target.value)}/></Field></details>
    <details className="ar-settings-section ar-details"><summary>主持模型</summary><div className="ar-form-grid">
      <Field label="模型来源"><select value={form.llm.mode} onChange={e => nested('llm', 'mode', e.target.value)}><option value="dsh">使用 DSH 已配置的模型</option><option value="api">独立兼容接口</option></select></Field>
      {form.llm.mode === 'dsh' ? <><Field label="提供方"><select value={form.llm.provider} onChange={e => { nested('llm', 'provider', e.target.value); nested('llm', 'model', ''); }}><option value="">请选择</option>{s.models?.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select></Field><Field label="模型"><input list="ar-models" value={form.llm.model} onChange={e => nested('llm', 'model', e.target.value)}/><datalist id="ar-models">{s.models?.find(p => p.id === form.llm.provider)?.models?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist></Field></>
        : <><Field label="接口地址"><input value={form.llm.baseUrl} onChange={e => nested('llm', 'baseUrl', e.target.value)}/></Field><Field label="模型"><input value={form.llm.model} onChange={e => nested('llm', 'model', e.target.value)}/></Field><Field label="API Key" help={s.settings.llm.hasKey ? '已保存，留空保留原密钥' : '仅保存在本机'}><input type="password" autoComplete="new-password" value={form.llm.apiKey || ''} onChange={e => nested('llm', 'apiKey', e.target.value)}/></Field></>}
    </div></details>
    {s.programmeStatus?.programme && <div className="ar-settings-section"><a className="ar-text-button" href="/dsh-ai-radio/programme/script" download>下载本期完整节目稿</a></div>}
  </section>;
}
