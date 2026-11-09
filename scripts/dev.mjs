import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RadioService } from '../lib/service.js';
import { attachDemo } from './demo.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!existsSync(join(root,'preview/app.js')))await import('./build.mjs');
const demo=process.argv.includes('--demo');
const service=new RadioService({directory:process.env.AI_RADIO_DATA_DIR||join(root,'.radio-data',demo?'demo':'local'),demo});
if(demo)attachDemo(service,{seconds:Number(process.env.AI_RADIO_DEMO_TRACK_SECONDS)||35});
const server=createServer((req,res)=>{
  if(req.url.startsWith('/dsh-ai-radio/'))return service.handler(req,res);
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!['/','/app.js'].includes(pathname)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':pathname==='/'?'text/html; charset=utf-8':'application/javascript; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(join(root,'preview',pathname==='/'?'index.html':'app.js')));
});
server.listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log(`Aurora FM ${demo?'DEMO (synthetic audio)':'local preview'}: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{service.dispose();server.close(()=>process.exit(0));});
