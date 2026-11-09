import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

// Compile the real JSX component rather than reimplementing its visibility
// conditions. Browser/server rendering both run the actual React component.
const compiled=await build({entryPoints:['client/app.jsx'],bundle:true,format:'esm',platform:'node',external:['react'],write:false,loader:{'.css':'text'}});
const { mkdtempSync, writeFileSync, rmSync }=await import('node:fs');
const { join, resolve }=await import('node:path');
const directory=mkdtempSync(resolve('test-results-overlay-'));
const modulePath=join(directory,'app.mjs');writeFileSync(modulePath,compiled.outputFiles[0].text);
const { pathToFileURL }=await import('node:url');
const { App }=await import(pathToFileURL(modulePath).href);
test.after(()=>rmSync(directory,{recursive:true,force:true}));
function render(state){const controller={snapshot:()=>state,subscribe:()=>()=>{},init(){},emit(){}};return renderToStaticMarkup(React.createElement(App,{controller,panelOnly:true}));}

test('closed shell overlay renders nothing while the radio is initializing',()=>{
  assert.equal(render({expanded:false,loading:true}), '');
});
test('closed shell overlay renders nothing after a backend connection failure',()=>{
  assert.equal(render({expanded:false,loading:false,settings:null,notice:'connection failed'}), '');
});
test('an explicitly opened radio can still show its reconnect action',()=>{
  assert.match(render({expanded:true,loading:false,settings:null,notice:'connection failed'}),/重新连接电台/);
});
