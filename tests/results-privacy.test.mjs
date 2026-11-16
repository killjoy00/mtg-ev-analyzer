import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {prepareResultsPolicies} from '../scripts/prepare-results-policies.mjs';
import {resultsRoute,recordResultsPublication} from '../worker/results-privacy.mjs';
const copy=JSON.parse(fs.readFileSync('docs/releases/results-policy-copy.json'));
test('release copies contain every approved paragraph on web and native, with moderation rules retained',()=>{
 const output=prepareResultsPolicies('.','2026-11-15');
 const native=output['mobile/src/nativeEditorial.ts'].replace(/^import type .*$/m,'').replaceAll(': ArticleSection[]','').replaceAll('export const ','var ');
 const context=vm.createContext({});vm.runInContext(native,context);
 for(const [key,items] of Object.entries(copy)){
  const privacy=['accounts','emails','public','retention','privacyChanges','choices'].includes(key);
  const paragraphs=(privacy?context.privacySections:context.termsSections).flatMap(s=>s.body);
  const web=output[(privacy?'privacy':'terms')+'/index.html'];
  for(const paragraph of items){assert.ok(paragraphs.some(p=>p.includes(paragraph)),key);assert.ok(web.includes(paragraph.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')),key);}
 }
 for(const name of ['privacy','terms']){
  assert.match(output[name+'/index.html'],/Last updated: 2026-11-15/);
  assert.match(output['mobile/app/'+name+'.tsx'],/Last updated: \{resultsPolicyReleaseDate\}/);
 }
 assert.ok(context.termsSections.flatMap(s=>s.body).some(p=>p.startsWith('Do not use a public identity to threaten')));
 assert.match(output['privacy/index.html'],/Resend for account and optional emails/);
 assert.match(output['privacy/index.html'],/within 28 days/);
 assert.doesNotMatch(output['privacy/index.html'],/Deletion removes attributable Pack One data/);
});
test('preparing policies leaves live files unchanged and release dates fail closed',()=>{
 const before=fs.readFileSync('privacy/index.html','utf8');
 const output=prepareResultsPolicies();assert.match(output['privacy/index.html'],/\{\{RELEASE_DATE\}\}/);
 assert.equal(fs.readFileSync('privacy/index.html','utf8'),before);
 assert.throws(()=>prepareResultsPolicies('.','2026-02-30'),/Real release date/);
 assert.throws(()=>prepareResultsPolicies('.','unreleased'),/Real release date/);
});
test('preparing already published copies preserves every paragraph without duplication',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'results-policy-repeat-'));
 try{
  const first=prepareResultsPolicies('.','2026-11-16');
  for(const [file,contents] of Object.entries(first)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),contents);}
  assert.deepEqual(prepareResultsPolicies(root,'2026-11-16'),first);
  const preview=prepareResultsPolicies(root);
  assert.equal((preview['privacy/index.html'].match(/Results and news emails/g)||[]).length,1);
  assert.match(preview['privacy/index.html'],/Last updated: \{\{RELEASE_DATE\}\}/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('web and native use identical exact choice copy and equal prompt buttons',()=>{
 const web=JSON.parse(fs.readFileSync('results-copy.json'));
 const source=fs.readFileSync('mobile/src/resultsCopy.ts','utf8');
 const native=JSON.parse(source.slice(source.indexOf('{'),source.lastIndexOf('}')+1));assert.deepEqual(native,web);
 assert.equal(web.yes,'Yes, email me');assert.equal(web.no,'No thanks');
 const ui=fs.readFileSync('results-settings.mjs','utf8');assert.doesNotMatch(ui,/showModal|\.focus\(/);
 assert.match(fs.readFileSync('daily-home.mjs','utf8'),/bindResultsInvitation/);
});
test('mutation authentication is used for browser writes and native account sessions for native writes',async()=>{
 let mutated=0,native=0;
 const auth={user_id:'11111111-1111-4111-8111-111111111111'};
 const args={json:Response.json,query:async()=>({rows:[]}),readJson:async()=>({}),authBrowser:()=>{throw Error('read auth must not authorize writes');},authMutation:async()=>{mutated++;return auth;},authMobile:async()=>{native++;return {auth};}};
 await assert.rejects(resultsRoute(new Request('https://test/v1/account/results',{method:'PATCH'}),args),/Account changed/);assert.equal(mutated,1);
 await assert.rejects(resultsRoute(new Request('https://test/v1/mobile/account/results',{method:'PATCH'}),args),/Account changed/);assert.equal(native,1);
});
test('private publication bookkeeping rejects credential-bearing or non-HTTPS links',async()=>{
 for(const link of ['http://example.invalid/a','https://user:secret@example.invalid/a','not a URL'])await assert.rejects(recordResultsPublication(()=>{throw Error('SQL must not run');},{authId:'fixture',channel:'website',link}));
});
