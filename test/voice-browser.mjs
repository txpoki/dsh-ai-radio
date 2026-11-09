import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const port=4197,origin='http://127.0.0.1:'+port;
const executablePath=process.env.RADIO_BROWSER_EXECUTABLE||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('test-results',{recursive:true});
const server=spawn(process.execPath,['scripts/dev.mjs','--demo'],{env:{...process.env,PORT:String(port),AI_RADIO_DEMO_TRACK_SECONDS:'8',AI_RADIO_DEMO_SPEECH_SECONDS:'3.5',AI_RADIO_DATA_DIR:resolve('test-results','voice-'+Date.now())},stdio:'ignore'});
let browser;const report={checks:[]};
try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/dsh-ai-radio/bootstrap')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--mute-audio']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.__radio?.state.settings&&!window.__radio.state.loading);
  let calls=0,release;
  const gate=new Promise(r=>{release=r;});
  await page.route('**/dsh-ai-radio/speech/prepare',async route=>{
    if(++calls===3){await gate;return route.continue();}
    if(await page.evaluate(()=>window.__radio.state.settings.tts.provider==='fish'))return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Fish 音色尚未配置 API Key，请在设置中填写并保存',code:'TTS_KEY_MISSING'})});
    return route.continue();
  });
  await page.evaluate(()=>{window.__voiceOnsets=[];window.__radio.voiceAudio.addEventListener('playing',()=>window.__voiceOnsets.push(performance.now()));});
  await page.getByTestId('play').click();
  await page.waitForFunction(()=>window.__radio.transitioning&&window.__radio.state.transitions===1,null,{timeout:25000});
  const nav=page.getByRole('navigation',{name:'电台导航'});
  await nav.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByLabel('语音服务',{exact:true}).selectOption('fish');
  await page.getByTestId('save-settings').click();
  await page.waitForFunction(()=>window.__radio.state.settings.tts.provider==='fish');
  await page.getByText('尚未配置 Fish API Key，所选音色暂不可用；不会自动改用其他声音。',{exact:true}).waitFor();
  const since=await page.evaluate(()=>performance.now());release();
  await page.waitForFunction(()=>window.__radio.state.transitions>=3&&window.__radio.state.notice.includes('API Key'),null,{timeout:20000});
  assert.equal(await page.evaluate(t=>window.__voiceOnsets.filter(x=>x>t).length,since),0);
  assert.equal(await page.evaluate(()=>window.__radio.voiceAudio.paused),true);
  report.checks.push('Changing the voice while an old preload is pending cannot play that old voice');
  await page.getByText('听听小鲸的声音',{exact:true}).click();
  await page.waitForFunction(()=>window.__radio.state.notice.includes('Fish 音色尚未配置 API Key'));
  assert.ok(await page.evaluate(()=>window.__radio.decks[window.__radio.current].audio.paused===false));
  report.checks.push('A missing Fish key is visible in settings and preview, without a substitute voice or stopping music');
  await page.getByLabel('语音服务',{exact:true}).selectOption('edge');
  await page.getByTestId('save-settings').click();
  await page.waitForFunction(()=>window.__radio.state.settings.tts.provider==='edge'&&window.__radio.state.spokenCount>2,null,{timeout:20000});
  report.checks.push('Selecting the free natural voice restores narration during the same music session');
  assert.deepEqual(errors,[]);report.success=true;for(const check of report.checks)console.log('PASS '+check);
  await page.evaluate(()=>window.__radio.dispose());
}catch(error){report.success=false;report.error=error.stack;throw error;}
finally{writeFileSync('test-results/voice-report.json',JSON.stringify(report,null,2)+'\n');await browser?.close();server.kill();}
