import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GENERATED_CAMPAIGN_MARKER,
  buildCampaignDraft,
  buildCampaignTrackingUrl,
  buildCampaignVanityUrl,
  isCanonicalAcquisitionValue,
  normalizeAcquisitionValue,
  renderCampaignRedirectPage,
  validateCampaignEntries
} from '../campaign-links.mjs';
import {generateCampaignLinks} from '../scripts/generate-campaign-links.mjs';

const productionEntry={
  slug:'reddit-launch',
  destination:'/',
  source:'reddit',
  campaign:'launch-week',
  medium:'social'
};

test('acquisition values share runtime normalization and canonical config rules',()=>{
  assert.equal(normalizeAcquisitionValue('a'),'a');
  assert.equal(normalizeAcquisitionValue('x'.repeat(40)),'x'.repeat(40));
  assert.equal(normalizeAcquisitionValue('x'.repeat(41)),null);
  assert.equal(normalizeAcquisitionValue('  Reddit  '),'reddit');
  assert.equal(normalizeAcquisitionValue('launch week'),null);
  assert.equal(normalizeAcquisitionValue('r/magictcg'),null);
  assert.equal(normalizeAcquisitionValue('SOCIAL'),'social');
  assert.equal(isCanonicalAcquisitionValue('reddit'),true);
  assert.equal(isCanonicalAcquisitionValue('Reddit'),false,'committed config must not silently normalize uppercase');
  assert.equal(isCanonicalAcquisitionValue(' reddit '),false,'committed config must not silently trim whitespace');
});

test('tracked campaign URL does not require a vanity slug',()=>{
  const draft=buildCampaignDraft({
    source:' Reddit ',
    campaign:' Launch-Week ',
    medium:' SOCIAL ',
    destination:'/'
  });
  assert.equal(draft.trackingValid,true);
  assert.equal(draft.valid,false,'full vanity entry still requires a slug');
  assert.equal(draft.errors.slug,undefined,'blank slug is allowed for tracked-only use');
  assert.equal(draft.entry,null);
  assert.equal(draft.vanityUrl,'');
  assert.equal(draft.trackedUrl,'https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social');

  const invalidSlug=buildCampaignDraft({
    slug:'bad/slug',
    source:'reddit',
    campaign:'launch-week',
    destination:'/'
  });
  assert.match(invalidSlug.errors.slug,/Use 1-64/);
  assert.equal(invalidSlug.trackedUrl,'https://packone.pro/?utm_source=reddit&utm_campaign=launch-week');
  assert.equal(invalidSlug.entry,null);
});

test('campaign config rejects duplicates, unsafe slugs, invalid acquisition fields and unsupported destinations',()=>{
  assert.deepEqual(validateCampaignEntries([productionEntry]),[productionEntry]);
  assert.throws(()=>validateCampaignEntries([productionEntry,{...productionEntry}]),/duplicates slug/);
  for(const slug of ['bad/slug','bad_slug','bad.slug','_hidden','.hidden','trailing-']) {
    assert.throws(()=>validateCampaignEntries([{...productionEntry,slug}]),/slug must be canonical/);
  }
  assert.throws(()=>validateCampaignEntries([{...productionEntry,source:'launch week'}]),/source must already be canonical/);
  assert.throws(()=>validateCampaignEntries([{...productionEntry,campaign:'r\/magictcg'}]),/campaign must already be canonical/);
  assert.throws(()=>validateCampaignEntries([{...productionEntry,medium:'x'.repeat(41)}]),/medium must already be canonical/);
  assert.throws(()=>validateCampaignEntries([{...productionEntry,source:'Reddit'}]),/source must already be canonical/);
  assert.throws(()=>validateCampaignEntries([{...productionEntry,destination:'/practice/'}]),/destination .* is not supported/);
});

test('checked-in production campaign config contains only reddit-launch',async()=>{
  const config=JSON.parse(await readFile('campaign-links.json','utf8'));
  assert.deepEqual(validateCampaignEntries(config),[productionEntry]);
  assert.equal(buildCampaignTrackingUrl(productionEntry),'https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social');
  assert.equal(buildCampaignVanityUrl(productionEntry.slug),'https://packone.pro/go/reddit-launch/');
});

test('generated reddit launch page is static crawler-friendly redirect HTML',async()=>{
  const file='go/reddit-launch/index.html';
  const html=await readFile(file,'utf8');
  assert.equal(html,renderCampaignRedirectPage(productionEntry),'committed generated page must match deterministic renderer');
  assert.match(html,/property="og:image" content="https:\/\/packone\.pro\/social-preview\.png"/);
  assert.match(html,/property="og:image:width" content="1200"/);
  assert.match(html,/property="og:image:height" content="630"/);
  assert.match(html,/name="twitter:card" content="summary_large_image"/);
  assert.match(html,/name="robots" content="noindex,nofollow"/);
  assert.match(html,/property="og:url" content="https:\/\/packone\.pro\/"/);
  assert.match(html,/rel="canonical" href="https:\/\/packone\.pro\/"/);
  assert.match(html,/location\.replace\("https:\/\/packone\.pro\/\?utm_source=reddit&utm_campaign=launch-week&utm_medium=social"\)/);
  assert.match(html,/href="https:\/\/packone\.pro\/\?utm_source=reddit&amp;utm_campaign=launch-week&amp;utm_medium=social"/);
  assert.equal((html.match(/<script(?:\s|>)/g)||[]).length,1,'generated page has only the inline redirect script');
  assert.doesNotMatch(html,/<script[^>]+src=/);
  assert.doesNotMatch(html,/bootstrap\.mjs|growth\.mjs|analytics|ads\.mjs|app\.js|retention-events|dataLayer|gtag\(/);
});

test('generated campaign social previews stay in parity with the homepage',async()=>{
  const homepage=await readFile('index.html','utf8');
  const campaign=await readFile('go/reddit-launch/index.html','utf8');

  const escapeRegex=value=>value.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
  const meta=(html,key,value)=>{
    const tag=html.match(new RegExp('<meta\\s+[^>]*'+key+'="'+escapeRegex(value)+'"[^>]*>'))?.[0];
    assert.ok(tag,'missing '+key+'="'+value+'" metadata');
    const content=tag.match(/content="([^"]*)"/)?.[1];
    assert.notEqual(content,undefined,'missing content for '+key+'="'+value+'"');
    return content;
  };

  for(const [key,value] of [
    ['property','og:title'],
    ['property','og:description'],
    ['property','og:image'],
    ['name','twitter:title'],
    ['name','twitter:description'],
    ['name','twitter:image']
  ]) {
    assert.equal(meta(campaign,key,value),meta(homepage,key,value),value+' must match homepage preview metadata');
  }
});

test('committed campaign pages are fresh',async()=>{
  const result=await generateCampaignLinks({root:process.cwd(),check:true});
  assert.deepEqual(result.slugs,['reddit-launch']);
});

test('generator check detects missing, stale and orphan generated output',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'packone-campaign-links-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'campaign-links.json'),JSON.stringify([productionEntry],null,2)+'\n');
  await generateCampaignLinks({root});
  await generateCampaignLinks({root,check:true});

  const generated=path.join(root,'go','reddit-launch','index.html');
  await appendFile(generated,'\n<!-- stale -->\n');
  await assert.rejects(generateCampaignLinks({root,check:true}),/stale generated page/);
  await generateCampaignLinks({root});

  await rm(generated);
  await assert.rejects(generateCampaignLinks({root,check:true}),/missing generated page/);
  await generateCampaignLinks({root});

  const orphanDir=path.join(root,'go','orphan');
  await mkdir(orphanDir,{recursive:true});
  await writeFile(path.join(orphanDir,'index.html'),GENERATED_CAMPAIGN_MARKER+'\n');
  await assert.rejects(generateCampaignLinks({root,check:true}),/orphan generated campaign directory/);
  await generateCampaignLinks({root});
  await assert.rejects(readFile(path.join(orphanDir,'index.html'),'utf8'),error=>error?.code==='ENOENT');
  await generateCampaignLinks({root,check:true});
});
