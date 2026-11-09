import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQRLogin } from '../lib/vendor/netease.js';
import { Store } from '../lib/store.js';
import { Context } from '../lib/context.js';
const directory=mkdtempSync(join(tmpdir(),'radio-external-smoke-'));
const report={checkedAt:new Date().toISOString(),note:'Unauthenticated public-service smoke test; no account cookie or paid API is used.'};
try{
  const store=new Store(directory);const context=new Context(store);
  const [qrResult,weatherResult,newsResult]=await Promise.allSettled([createQRLogin(),context.weather(),context.news()]);
  report.qr=qrResult.status==='fulfilled'?{created:!!qrResult.value.key,imageGenerated:!!qrResult.value.imageDataUrl}:{created:false,error:qrResult.reason.message};
  report.weather=weatherResult.status==='fulfilled'?{available:!!weatherResult.value,...(weatherResult.value?{city:weatherResult.value.city,temperature:weatherResult.value.temperature,source:weatherResult.value.source}:{error:context.weatherError})}:{available:false,error:weatherResult.reason.message};
  report.news=newsResult.status==='fulfilled'?{count:newsResult.value.length,sources:[...new Set(newsResult.value.map(x=>x.source))],sourceFailures:context.newsCache?.errors||[]}:{count:0,error:newsResult.reason.message};
  writeFileSync('docs/external-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{rmSync(directory,{recursive:true,force:true});}
