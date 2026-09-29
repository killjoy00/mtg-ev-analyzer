import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {digest} from '../worker/account-session.mjs';
import {
  campaignLinkPublishConfigured,
  dispatchCampaignLinkPublish,
  handleCampaignLinkPublish,
  normalizeCampaignPublishPayload,
} from '../worker/campaign-link-publish.mjs';
import {prepareCampaignLinkPublish} from '../scripts/prepare-campaign-link-publish.mjs';

const TOKEN='github_pat_fixture_abcdefghijklmnopqrstuvwxyz';
const USER='11111111-1111-4111-8111-111111111111';
const entry={slug:'newsletter-launch',destination:'/',source:'newsletter',campaign:'launch-week',medium:'email'};
const publishWorkflow=readFileSync('.github/workflows/campaign-link-publish.yml','utf8');

test('campaign publish workflow preserves protected-main publication',()=>{
  assert.match(publishWorkflow,/permissions:\s+[\s\S]*contents: write[\s\S]*pull-requests: write[\s\S]*actions: write[\s\S]*pages: write/);
  assert.ok(publishWorkflow.includes('git push --force origin "HEAD:refs/heads/${branch}"'));
  assert.ok(!publishWorkflow.includes('HEAD:refs/heads/main'));
  assert.ok(!publishWorkflow.includes('HEAD:main'));
  assert.ok(publishWorkflow.includes('gh pr create'));
  assert.ok(publishWorkflow.includes('gh workflow run test.yml --ref "$BRANCH"'));
  assert.ok(publishWorkflow.includes('gh workflow run e2e.yml --ref "$BRANCH"'));
  assert.ok(publishWorkflow.includes('gh pr merge "$PR_URL" --squash --delete-branch'));
  assert.ok(publishWorkflow.includes('repos/${GITHUB_REPOSITORY}/pages/builds'));
  assert.match(publishWorkflow,/timeout-minutes: 60/);
});
test('campaign publish configuration follows the scoped production dispatch credential',()=>{
  assert.equal(campaignLinkPublishConfigured({PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN}),true);
  assert.equal(campaignLinkPublishConfigured({}),false);
  assert.equal(campaignLinkPublishConfigured({PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'not-a-token'}),false);
});

test('campaign publish payload is canonicalized and rejects unsupported fields',()=>{
  const result=normalizeCampaignPublishPayload({
    slug:' Newsletter-Launch ',
    destination:'/',
    source:' NEWSLETTER ',
    campaign:' Launch-Week ',
    medium:' EMAIL ',
  });
  assert.deepEqual(result.entry,entry);
  assert.equal(result.vanityUrl,'https://packone.pro/go/newsletter-launch/');
  assert.equal(result.trackedUrl,'https://packone.pro/?utm_source=newsletter&utm_campaign=launch-week&utm_medium=email');
  assert.throws(()=>normalizeCampaignPublishPayload({...entry,workflow:'other.yml'}),error=>error?.status===400&&error?.code==='CAMPAIGN_LINK_INVALID');
  assert.throws(()=>normalizeCampaignPublishPayload({...entry,slug:'bad/slug'}),error=>error?.status===400&&error?.code==='CAMPAIGN_LINK_INVALID');
});

test('campaign publish dispatch is fixed to the reviewed workflow and main',async()=>{
  const calls=[];
  await dispatchCampaignLinkPublish(entry,{
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},
    fetcher:async(url,options)=>{calls.push({url,options});return new Response(null,{status:204});},
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/campaign-link-publish.yml/dispatches');
  assert.equal(calls[0].options.headers.authorization,'Bearer '+TOKEN);
  assert.deepEqual(JSON.parse(calls[0].options.body),{
    ref:'main',
    inputs:{slug:'newsletter-launch',destination:'/',source:'newsletter',campaign:'launch-week',medium:'email'},
  });
  await assert.rejects(dispatchCampaignLinkPublish(entry,{
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},
    fetcher:async()=>new Response('{}',{status:403}),
  }),error=>error?.status===503&&error?.code==='CAMPAIGN_PUBLISH_DISPATCH');
});

function adminQuery({admin=true,account='a'.repeat(43),csrf='b'.repeat(43)}={}) {
  return async(sql,params)=>{
    if(sql.includes('FROM account_sessions')) {
      assert.equal(params[0],digest(account));
      return {rows:[{session_hash:digest(account),csrf_hash:digest(csrf),expires_at:'2099-01-01',user_id:USER,email:'admin@example.com',name:'Admin'}]};
    }
    if(sql.includes('FROM pack1_admins')) {
      assert.deepEqual(params,[USER]);
      return {rows:admin?[{}]:[]};
    }
    throw new Error('Unexpected query: '+sql);
  };
}

function publishRequest(body=entry,{csrf='b'.repeat(43)}={}) {
  return new Request('https://origin.test/v1/admin/campaign-links/publish',{
    method:'POST',
    headers:{
      origin:'https://packone.pro',
      'content-type':'application/json',
      cookie:'__Host-pack1_account='+'a'.repeat(43),
      'x-pack1-csrf':csrf,
    },
    body:JSON.stringify(body),
  });
}

test('campaign publish endpoint requires a live admin session and CSRF proof',async()=>{
  let dispatched=0;
  const response=await handleCampaignLinkPublish(publishRequest(),{
    query:adminQuery(),
    readJson:request=>request.json(),
    allowedOrigins:new Set(['https://packone.pro']),
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},
    fetcher:async()=>{dispatched++;return new Response(null,{status:204});},
  });
  assert.equal(response.status,202);
  assert.equal(dispatched,1);
  assert.deepEqual(await response.json(),{
    ok:true,status:'queued',slug:'newsletter-launch',
    tracked_url:'https://packone.pro/?utm_source=newsletter&utm_campaign=launch-week&utm_medium=email',
    vanity_url:'https://packone.pro/go/newsletter-launch/',
  });

  await assert.rejects(handleCampaignLinkPublish(publishRequest(entry,{csrf:'c'.repeat(43)}),{
    query:adminQuery(),readJson:request=>request.json(),allowedOrigins:new Set(['https://packone.pro']),
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},fetcher:async()=>{throw Error('must not dispatch');},
  }),error=>error?.status===403);

  await assert.rejects(handleCampaignLinkPublish(publishRequest(),{
    query:adminQuery({admin:false}),readJson:request=>request.json(),allowedOrigins:new Set(['https://packone.pro']),
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},fetcher:async()=>{throw Error('must not dispatch');},
  }),error=>error?.status===403&&error?.code==='ADMIN_REQUIRED');
});

test('campaign publication preparation appends once and refuses slug reassignment',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'packone-campaign-publish-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const baseline={slug:'reddit-launch',destination:'/',source:'reddit',campaign:'launch-week',medium:'social'};
  await writeFile(path.join(root,'campaign-links.json'),JSON.stringify([baseline],null,2)+'\n');

  const first=await prepareCampaignLinkPublish({root,entry});
  assert.equal(first.created,true);
  const config=JSON.parse(await readFile(path.join(root,'campaign-links.json'),'utf8'));
  assert.deepEqual(config.map(row=>row.slug),['newsletter-launch','reddit-launch']);
  const generated=await readFile(path.join(root,'go','newsletter-launch','index.html'),'utf8');
  assert.match(generated,/utm_source=newsletter&utm_campaign=launch-week&utm_medium=email/);

  const second=await prepareCampaignLinkPublish({root,entry});
  assert.equal(second.created,false);
  await assert.rejects(
    prepareCampaignLinkPublish({root,entry:{...entry,source:'reddit'}}),
    /already exists with different attribution/,
  );
});
