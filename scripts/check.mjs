import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
const files=[];const walk=dir=>{for(const item of readdirSync(dir,{withFileTypes:true})){const path=dir+'/'+item.name;if(item.isDirectory())walk(path);else if(/\.(m?js)$/.test(item.name))files.push(path);}};
walk('lib');walk('scripts');
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status)process.exit(result.status);}
const pkg=JSON.parse(readFileSync('package.json','utf8'));
if(pkg.dsh.bundle.patch!=='./cordis.patch.yml'||!pkg.exports['./client'])throw new Error('DSH manifest incomplete');
console.log(`Syntax and DSH manifest checks passed (${files.length} JavaScript files).`);
