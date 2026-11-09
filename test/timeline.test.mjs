import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { segueCue, programmeTimeline, PRE_DUCK_SECONDS } from '../lib/timeline.js';
import { Store } from '../lib/store.js';
import { Speech } from '../lib/tts.js';
import { wav } from '../scripts/demo.mjs';
test('a long segue spans both songs without delaying the incoming song', () => {
  const cue = segueCue({ outgoingSeconds: 180, incomingSeconds: 220, speechSeconds: 22, crossfadeSeconds: 6 });
  assert.equal(cue.musicStart, 174); assert.equal(cue.speechStart, 166); assert.equal(cue.speechEnd, 188);
  assert.ok(cue.duckAt <= cue.speechStart - 1);
  assert.ok(cue.speechEnd > 180 && cue.musicStart < 180);
});
test('short segues keep the same music schedule and get a full pre-duck cue', () => {
  const cue = segueCue({ outgoingSeconds: 180, incomingSeconds: 220, speechSeconds: 3, crossfadeSeconds: 6 });
  assert.equal(cue.musicStart, 174); assert.ok(cue.speechStart > cue.musicStart);
  assert.ok(Math.abs(cue.speechStart - cue.duckAt - PRE_DUCK_SECONDS) < .001);
});
test('complete episode timing contains measured speech and overlapping music entries', () => {
  const p = { opening: { duration: 8 }, segments: [0,1,2].map(i => ({ track: { id: String(i), interval: 180 }, speech: { duration: 20 }, cue: {} })) };
  const timeline = programmeTimeline(p, { crossfadeSeconds: 6 });
  assert.ok(timeline[1].musicStart < timeline[0].musicStart + 180);
  assert.ok(timeline[1].speechEnd > timeline[1].musicStart);
});
test('measured speech duration survives process restart through the disk cache', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'radio-duration-'));
  try {
    const store = new Store(directory); let calls = 0;
    const speech = new Speech(store, { edgeImpl: async () => { calls++; return { bytes: wav(2.75), type: 'audio/wav' }; } });
    const first = await speech.prepare('一段真实时长测试');
    assert.equal(first.duration, 2.75); assert.equal(first.measured, true);
    const restored = new Speech(store, { edgeImpl: async () => { throw new Error('network should not be called'); } });
    const next = await restored.prepare('一段真实时长测试'); assert.equal(next.duration, 2.75); assert.equal(calls, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('whole-episode voice preparation supplies an actual duration for each cue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'radio-voice-plan-'));
  try {
    const speech = new Speech(new Store(directory), { edgeImpl: async () => ({ bytes: wav(1.5), type: 'audio/wav' }) });
    const p = { opening: { text: '开场' }, segments: [{ speech: { text: '第一首' } }, { speech: { text: '第二首' } }] };
    await speech.prepareProgramme(p, { signal: new AbortController().signal, progress() {} });
    assert.deepEqual(p.audioTiming, { measured: 3, total: 3, failed: 0 });
    assert.equal(p.segments[1].speech.duration, 1.5);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
