import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const port = 4193, origin = 'http://127.0.0.1:' + port;
const executablePath = process.env.RADIO_BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('test-results', { recursive: true });
const server = spawn(process.execPath, ['scripts/dev.mjs', '--demo'], { env: { ...process.env, PORT: String(port), AI_RADIO_DEMO_TRACK_SECONDS: '8', AI_RADIO_DEMO_SPEECH_SECONDS: '3.5', AI_RADIO_DATA_DIR: resolve('test-results', 'mix-' + Date.now()) }, stdio: 'ignore' });
let browser;
const report = { fixture: { musicSeconds: 8, speechSeconds: 3.5, crossfadeSeconds: 2 }, checks: [] };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/dsh-ai-radio/bootstrap')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--mute-audio'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__radio?.state.settings && !window.__radio.state.loading);
  await page.evaluate(() => {
    const r = window.__radio;
    window.__mix = { starts: [], samples: [], songs: [], duckBegan: 0 };
    const m = window.__mix;
    r.voiceAudio.addEventListener('playing', () => m.starts.push({ at: performance.now(), transition: r.state.transitions, gain: r.musicBus.gain.value, leadMs: m.duckBegan ? performance.now() - m.duckBegan : 0 }));
    for (const d of r.decks) d.audio.addEventListener('playing', () => {
      if (!d.segment) return;
      const other = r.decks[1 - d.index];
      m.songs.push({ at: performance.now(), voicePlaying: !r.voiceAudio.paused && !r.voiceAudio.ended, outgoingPlaying: !other.audio.paused && !other.audio.ended, outgoingPosition: other.audio.currentTime });
    });
    m.timer = setInterval(() => {
      if (!r.running) return;
      if (r.musicBus.gain.value < .4) { if (!m.duckBegan) m.duckBegan = performance.now(); } else m.duckBegan = 0;
      if (r.current < 0 || !r.state.speech || r.voiceAudio.paused || r.voiceAudio.ended) return;
      const music = r.decks.filter(d => !d.audio.paused && !d.audio.ended && d.gain.gain.value > .01);
      m.samples.push({ transition: r.state.transitions, music: music.length, afterOutgoingEnd: r.decks.some(d => d !== r.decks[r.current] && d.audio.ended), bed: !r.bedAudio.paused, voicePosition: r.voiceAudio.currentTime });
    }, 25);
  });
  await page.getByTestId('play').click();
  await page.waitForFunction(() => window.__radio.state.transitions >= 4 && window.__radio.state.spokenCount >= 5, null, { timeout: 45000 });
  const metrics = await page.evaluate(() => {
    const m = window.__mix;
    clearInterval(m.timer);
    return { starts: m.starts, songs: m.songs, sampleCount: m.samples.length, drySamples: m.samples.filter(s => !s.music).length, overlapSamples: m.samples.filter(s => s.music === 2).length, afterOutgoingEnd: m.samples.filter(s => s.afterOutgoingEnd && s.music && s.voicePosition > 2).length, bedSamples: m.samples.filter(s => s.bed).length };
  });
  assert.deepEqual(errors, []);
  assert.ok(metrics.sampleCount > 150);
  assert.equal(metrics.drySamples, 0, 'Every sampled in-song voice instant must have music');
  assert.ok(metrics.overlapSamples > 20, 'Both real music decks must overlap beneath the voice');
  assert.ok(metrics.afterOutgoingEnd > 5, 'The incoming song must continue when voice outlasts the outgoing song');
  assert.equal(metrics.bedSamples, 0, 'Regular segues must use the songs themselves');
  assert.ok(metrics.songs.slice(1).every(x => x.outgoingPlaying && x.voicePlaying));
  const segues = metrics.starts.filter(x => x.transition >= 1);
  assert.ok(segues.length >= 3);
  assert.ok(segues.every(x => x.gain < .25 && x.leadMs > 750), 'Music must audibly duck before speech starts');
  report.metrics = metrics;
  report.checks.push('Long narration spans outgoing and incoming songs with zero dry music samples', 'Independent music crossfade begins before the outgoing song ends', 'Music ducks at least 750ms before each measured voice onset');
  report.success = true;
  for (const check of report.checks) console.log('PASS ' + check);
  await page.evaluate(() => window.__radio.dispose());
} catch (error) { report.success = false; report.error = error.stack; throw error; }
finally { writeFileSync('test-results/mix-report.json', JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
