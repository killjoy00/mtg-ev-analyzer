import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyRejectedOrigin} from '../worker/origin-telemetry.mjs';

test('rejected origins are classified without leaking more than a bounded hostname',()=>{
  assert.deepEqual(classifyRejectedOrigin(null),{origin_class:'missing',origin_host:null});
  assert.deepEqual(classifyRejectedOrigin(''),{origin_class:'missing',origin_host:null});
  assert.deepEqual(classifyRejectedOrigin('null'),{origin_class:'null_origin',origin_host:null});
  assert.deepEqual(classifyRejectedOrigin('not a url'),{origin_class:'unparseable',origin_host:null});
  assert.deepEqual(classifyRejectedOrigin('https://WWW.PackOne.pro'),{origin_class:'unexpected_https',origin_host:'www.packone.pro'});
  assert.deepEqual(classifyRejectedOrigin('https://user:secret@evil.example:8443/path?q=1#x'),{origin_class:'unexpected_https',origin_host:'evil.example'});
  assert.deepEqual(classifyRejectedOrigin('http://localhost:4173'),{origin_class:'unexpected_other',origin_host:'localhost'});
  assert.deepEqual(classifyRejectedOrigin('chrome-extension://abcdefghijklmnop'),{origin_class:'unexpected_other',origin_host:'abcdefghijklmnop'});
  assert.deepEqual(classifyRejectedOrigin('http://192.168.1.20:8080'),{origin_class:'unexpected_other',origin_host:'ip-literal'});
  assert.deepEqual(classifyRejectedOrigin('https://[::1]'),{origin_class:'unexpected_https',origin_host:'ip-literal'});
  assert.deepEqual(classifyRejectedOrigin('https://'+'a'.repeat(300)+'.example'),{origin_class:'unexpected_https',origin_host:null});
  for(const value of ['https://user:secret@evil.example:8443/path?q=1#x','http://192.168.1.20:8080']) {
    const logged=JSON.stringify(classifyRejectedOrigin(value));
    assert.doesNotMatch(logged,/secret|8443|path|q=1|192\.168/);
  }
});

test('browser player-session rejections log the classification and still return the original 403',()=>{
  const source=fs.readFileSync(new URL('../worker/growth-function.js',import.meta.url),'utf8');
  const start=source.indexOf('async function handleBrowserPlayerSession(');
  const handler=source.slice(start,source.indexOf('\n}\n',start));
  assert.match(handler,/try \{\n    requireTrustedOrigin\(request,ALLOWED_ORIGINS\);\n  \} catch\(error\) \{/);
  assert.match(handler,/if\(error\?\.status===403\)console\.log\(JSON\.stringify\(\{\n      event:'player_session_origin_rejected',\n      \.\.\.classifyRejectedOrigin\(request\.headers\.get\('origin'\)\),/);
  assert.match(handler,/route_class:existingOnly\?'player_session_refresh':'player_session'/);
  assert.match(handler,/\n    throw error;\n  \}/);
  const logged=handler.slice(handler.indexOf("event:'player_session_origin_rejected'"),handler.indexOf('throw error;'));
  assert.doesNotMatch(logged,/cookie|authorization|cf-connecting-ip|x-forwarded-for|headers\.get\('(?!origin)/i);
});
