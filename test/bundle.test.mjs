import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
test('built browser plugin loads through the DSH ModuleLoader contract',()=>{
  if(!existsSync('lib/client.js'))return;
  let descriptor;const require=createRequire(import.meta.url);
  vm.runInNewContext(readFileSync('lib/client.js','utf8'),{window:{__ModuleLoader__:{load:x=>{descriptor=x;}}},console});
  assert.equal(descriptor.id,'dsh-ai-radio');const plugin=descriptor.factory(require);assert.equal(typeof plugin.apply,'function');assert.deepEqual(Array.from(plugin.inject),['slots']);
});
