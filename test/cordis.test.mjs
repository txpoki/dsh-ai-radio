import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../lib/index.js';

// CI uses the pinned published runtime. On a DSH machine the very same test
// can import its bundled runtime with DSH_CORDIS_ENTRY, avoiding a mock loader.
const { Context } = await import(process.env.DSH_CORDIS_ENTRY ? pathToFileURL(process.env.DSH_CORDIS_ENTRY).href : '@deepseek-ai/cordis');
const settle = async () => { for (let i=0;i<10;i++) await new Promise(resolve=>setTimeout(resolve,0)); };

test('the real Cordis loader activates the radio after actual DSH services become available',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'radio-cordis-'));
  const root=new Context();let route=null,tool=null,prompt=null;
  root.provide('webServer',{register(value){route=value;return()=>{route=null;};}});
  const fiber=root.plugin(plugin,{dataDir:directory});
  try{
    await settle();assert.equal(route,null,'activation must wait for declared services');
    root.provide('llm',{listProviders:()=>[],listModels:async()=>[]});
    root.provide('tools',{register(value){tool=value;return()=>{tool=null;};}});
    root.provide('systemPrompt',{section(value){prompt=value;}});
    await settle();await fiber.await();
    assert.equal(fiber.state,2,'plugin must become active; required/optional are not service names');
    assert.equal(route?.path,'/dsh-ai-radio');assert.equal(typeof route?.handler,'function');
    assert.equal(tool?.name,'ai_radio');assert.ok(prompt?.text);
    assert.deepEqual(Object.keys(fiber.inject).sort(),['llm','systemPrompt','tools','webServer']);
    await fiber.dispose();await settle();assert.equal(route,null);assert.equal(tool,null);
  }finally{await fiber.dispose();await root.fiber.dispose();rmSync(directory,{recursive:true,force:true});}
});
