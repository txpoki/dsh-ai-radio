import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const port = 4191, origin = 'http://127.0.0.1:' + port;
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('test-results', { recursive: true });
const server = spawn(process.execPath, ['scripts/dev.mjs', '--demo'], { env: { ...process.env, PORT: String(port), AI_RADIO_DEMO_TRACK_SECONDS: '6', AI_RADIO_DATA_DIR: resolve('test-results', 'startup-' + Date.now()) }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/dsh-ai-radio/bootstrap')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--mute-audio'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', x => errors.push(x.message));
  await page.goto(origin); await page.waitForFunction(() => window.__radio?.state.settings && !window.__radio.state.loading);
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/dsh-ai-radio/programme/start', async route => { await gate; await route.continue(); });
  await page.getByTestId('play').click();
  await page.waitForFunction(() => window.__radio.state.status === 'preparing' && !window.__radio.bedAudio.paused && window.__radio.bedAudio.currentTime > .2);
  assert.equal(await page.evaluate(() => window.__radio.current), -1);
  console.log('PASS Station background music starts while the model request is still pending');
  await page.getByTestId('play').click();
  const pos = await page.evaluate(() => window.__radio.bedAudio.currentTime); await page.waitForTimeout(200);
  assert.ok(Math.abs(await page.evaluate(() => window.__radio.bedAudio.currentTime) - pos) < .05);
  await page.getByTestId('play').click(); release();
  await page.waitForFunction(() => window.__radio.state.status === 'playing' && window.__radio.state.spokenCount >= 2, null, { timeout: 20000 });
  console.log('PASS Pause/resume during analysis preserves startup and continues automatically into real audio');
  assert.deepEqual(errors, []); await page.evaluate(() => window.__radio.dispose());
} finally { await browser?.close(); server.kill(); }
