import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const port=4199,origin='http://127.0.0.1:'+port;
const executablePath=process.env.RADIO_BROWSER_EXECUTABLE||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('test-results',{recursive:true});
const server=spawn(process.execPath,['scripts/dev.mjs','--demo'],{env:{...process.env,PORT:String(port),AI_RADIO_DATA_DIR:resolve('test-results','editorial-'+Date.now())},stdio:'ignore'});
let browser;const report={checks:[]};
try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/dsh-ai-radio/bootstrap')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.__radio?.state.settings&&!window.__radio.state.loading);
  await page.getByRole('navigation',{name:'电台导航'}).getByRole('button',{name:'设置',exact:true}).click();
  await page.getByText('主持人设',{exact:true}).click();
  await page.getByRole('button',{name:'预览三段口播',exact:true}).click();
  const sample=page.getByLabel('主持口播预览',{exact:true});await sample.waitFor();
  assert.equal(await sample.locator('strong').count(),4);
  const state=await page.evaluate(()=>({running:window.__radio.running,transitions:window.__radio.state.transitions,status:window.__radio.state.status}));
  assert.equal(state.running,false);assert.equal(state.transitions,0);assert.equal(state.status,'idle');
  const programme=await(await fetch(origin+'/dsh-ai-radio/programme')).json();assert.equal(programme.programme,null);
  report.checks.push('Settings previews a greeting and three spoken links without starting or replacing the programme');
  await sample.scrollIntoViewIfNeeded();await page.screenshot({path:'docs/screenshot-editorial-preview.png'});
  await page.setViewportSize({width:430,height:932});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const box=await sample.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=430);
  report.checks.push('The original conversational preview fits the compact mobile Settings layout');
  assert.deepEqual(errors,[]);report.success=true;for(const check of report.checks)console.log('PASS '+check);
  await page.evaluate(()=>window.__radio.dispose());
}catch(error){report.success=false;report.error=error.stack;throw error;}
finally{writeFileSync('test-results/editorial-report.json',JSON.stringify(report,null,2)+'\n');await browser?.close();server.kill();}
