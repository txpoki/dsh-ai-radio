import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const port = 4195, origin = 'http://127.0.0.1:' + port;
const executablePath = process.env.RADIO_BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('test-results', { recursive: true });
const server = spawn(process.execPath, ['scripts/dev.mjs', '--demo'], { env: { ...process.env, PORT: String(port), AI_RADIO_DEMO_TRACK_SECONDS: '8', AI_RADIO_DATA_DIR: resolve('test-results', 'daily-' + Date.now()) }, stdio: 'ignore' });
let browser; const report = { checks: [] };
try {
  for (let i=0;i<100;i++) { try { if ((await fetch(origin+'/dsh-ai-radio/bootstrap')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.__radio?.state.settings&&!window.__radio.state.loading);
  const nav=page.getByRole('navigation',{name:'电台导航'});
  await nav.getByRole('button',{name:'我的歌单',exact:true}).click();
  const daily=page.getByRole('article',{name:'网易云每日推荐'}), start=daily.getByRole('button',{name:'从每日推荐开始今日电台',exact:true});
  await start.waitFor();await page.waitForFunction(()=>!document.querySelector('.ar-daily .ar-button').disabled);
  assert.match(await daily.textContent(),/4 首/);
  assert.deepEqual(await nav.getByRole('button').allTextContents(),['正在收听','我的歌单','设置']);
  await page.screenshot({path:'docs/screenshot-library.png'});
  await start.click();
  await page.waitForFunction(()=>window.__radio.state.librarySource?.type==='daily'&&window.__radio.state.transitions>=1&&window.__radio.state.spokenCount>=2,null,{timeout:20000});
  assert.equal(await page.evaluate(()=>window.__radio.state.libraryCount),4);
  const programme=await(await fetch(origin+'/dsh-ai-radio/programme')).json();assert.equal(programme.programme.trackCount,4);
  report.checks.push('Daily recommendation card prepares and plays a complete four-song episode');
  await nav.getByRole('button',{name:'我的歌单',exact:true}).click();
  await page.getByRole('button',{name:'从这个歌单开始今日电台',exact:true}).first().click();
  await page.waitForFunction(()=>window.__radio.state.librarySource?.type==='playlists'&&window.__radio.state.libraryCount===12&&window.__radio.state.transitions>=2,null,{timeout:20000});
  report.checks.push('Switching back to a playlist restores the ordinary playlist source and starts playback');
  await page.evaluate(()=>window.__radio.stop());
  await page.route('**/dsh-ai-radio/recommendations/daily',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'每日推荐暂时无法读取，请稍后刷新'})}));
  await nav.getByRole('button',{name:'我的歌单',exact:true}).click();
  await daily.getByText('每日推荐暂时无法读取，请稍后刷新').waitFor();
  assert.equal(await page.getByRole('button',{name:'从这个歌单开始今日电台',exact:true}).first().isEnabled(),true);
  await page.setViewportSize({width:430,height:932});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const box=await daily.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=430);
  report.checks.push('A daily recommendation failure preserves usable playlist controls and a fitting mobile layout');
  assert.deepEqual(errors,[]);report.success=true;for(const item of report.checks)console.log('PASS '+item);
  await page.evaluate(()=>window.__radio.dispose());
}catch(error){report.success=false;report.error=error.stack;throw error;}
finally{writeFileSync('test-results/daily-report.json',JSON.stringify(report,null,2)+'\n');await browser?.close();server.kill();}
