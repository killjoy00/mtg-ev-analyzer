import test from 'node:test';
import assert from 'node:assert/strict';
import {originsIn,scanHtml,scanJs} from '../scripts/audit-site-csp.mjs';

test('HTML audit hashes exact inline bytes and separates external script references',()=>{
  const html='<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">'+
    '<script>\n alert("hello");\n</script><script src="https://cdn.example.test/script.js"></script>'+
    '<button onclick="doSomething()" style="display:none">OK</button>';
  const x=scanHtml('index.html',html);
  assert.equal(x.inlineScripts.length,1);
  assert.match(x.inlineScripts[0].sha256,/^'sha256-[A-Za-z0-9+/=]+'$/);
  assert.equal(x.externalScripts[0],'https://cdn.example.test/script.js');
  assert.deepEqual(x.eventHandlers,['onclick']);
  assert.equal(x.inlineStyles.length,1);
  assert.equal(x.metaPolicies.length,1);
  assert.deepEqual(x.originHints,['https://cdn.example.test']);
});
test('JS scanner flags dynamic creation, imports, HTML writes and origin hints without executing',()=>{
  const code=[
    "const script=document.createElement('script');",
    "script.src='https://ad.example.test/show.js';",
    "host.innerHTML=someValue;",
    "import('./other.mjs');",
    "window.open('https://login.example.test');"
  ].join('\n');
  const x=scanJs('ads.mjs',code);
  assert.deepEqual(x.sinks.map(z=>z.kind),[
    'script-creation','script-src-assignment','html-sink','dynamic-import','open-window'
  ]);
  assert.deepEqual(x.sinks.map(z=>z.line),[1,2,3,4,5]);
  assert.deepEqual(x.originHints,['https://ad.example.test','https://login.example.test']);
});
test('literal URLs in same-origin source do not inflate third-party hint list',()=>{
  assert.deepEqual(originsIn('https://packone.pro/ and https://api.packone.pro/v1'),['https://api.packone.pro']);
});
