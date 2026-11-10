import { cleanText } from './store.js';

const modes = ['brief', 'life', 'story', 'callback'];
const cycle = ['story', 'life', 'brief', 'story', 'callback', 'brief'];
export function linkPlan(order, suggestions = [], facts = new Map()) {
  const proposed = new Map((Array.isArray(suggestions) ? suggestions : []).map(x => [String(x.songId), x]));
  let stories = 0, previous = '';
  return order.map((song, index) => {
    const suggestion = proposed.get(song.id);
    let mode = !index ? 'first' : index % 3 === 2 ? 'brief' : modes.includes(suggestion?.mode) ? suggestion.mode : cycle[index % cycle.length];
    if (mode === 'story' && (!facts.get(song.id)?.sources?.length || stories >= Math.ceil(order.length / 3))) mode = 'life';
    if (mode === 'callback' && index < 4) mode = 'life';
    if (mode === previous && mode !== 'brief') mode = 'brief';
    if (mode === 'story') stories++;
    previous = mode;
    return { mode, targetSeconds: mode === 'brief' ? 5 : mode === 'story' || mode === 'first' ? 22 : 14, focus: cleanText(suggestion?.focus, 160) };
  });
}
const stop = text => text && /[。！？!?…]$/.test(text) ? text : text ? text + '。' : '';
function chat(value, song, limit) {
  const identities = [song.title, song.album, ...(song.artists || [])].filter(Boolean).map(x => x.toLowerCase());
  const musicClaim = /作曲|作词|创作|录制|录音|收录|发行|厂牌|原声|配乐|专辑|黑胶|唱片|格莱美|采样|转调|和声|鼓点|\bCD\b|\b(?:19|20)\d{2}\b|\d+(?:\.\d+)?\s*(?:年|岁|分钟|秒)/i;
  const sentences = cleanText(value, 300).match(/[^。！？!?]+[。！？!?]?/g) || [];
  let result = '';
  for (const sentence of sentences) {
    // Artist facts belong in the separately sourced slot even if a model
    // places them in its conversation field. This is a backstop, not a
    // semantic fact checker; unsupported story claims still need sources.
    if (musicClaim.test(sentence) || identities.some(x => sentence.toLowerCase().includes(x))) continue;
    if (result.length + sentence.length > limit + 16) break;
    result += sentence;
  }
  return result;
}
export function announce(song, index = 0) {
  const name = song.artists?.join('、') || '';
  const title = '《' + song.title + '》';
  return ['来听' + name + '的' + title + '。', name + '，' + title + '。', '下一首，' + name + '的' + title + '。'][index % 3];
}
export function composeLink(song, index, line = {}, sources = [], plan = { mode: 'life' }) {
  if (plan.mode === 'brief') return { intro: announce(song, index), sourceIds: [], deliveryMode: 'brief' };
  const valid = [...new Set((Array.isArray(line.sourceIds) ? line.sourceIds : []).filter(id => sources.some(x => x.id === id)))];
  if (Object.hasOwn(line, 'hostTalk') || Object.hasOwn(line, 'songFact')) {
    const hostTalk = chat(line.hostTalk, song, plan.mode === 'story' ? 24 : 55);
    const songFact = ['first','story'].includes(plan.mode) && valid.length ? cleanText(line.songFact, 70) : '';
    return { intro: [stop(hostTalk), stop(songFact), announce(song, index)].filter(Boolean).join(''), sourceIds: songFact ? valid : [], deliveryMode: plan.mode };
  }
  // Keep older adapters compatible without admitting unverified artist facts.
  return { intro: valid.length ? cleanText(line.intro, 180) || announce(song, index) : announce(song, index), sourceIds: valid, deliveryMode: plan.mode };
}
