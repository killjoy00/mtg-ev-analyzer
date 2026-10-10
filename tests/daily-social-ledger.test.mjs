import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubReceiptLedger,discordReceiptKey} from '../scripts/daily-social-ledger.mjs';

const url='https://discord.com/api/webhooks/123456789/token_ABC-def';

function fakeGitHub() {
 const comments=[];
 let nextId=1;
 const requests=[];
 const fetchImpl=async(resource,options={})=>{
   const endpoint=new URL(resource);
   const method=options.method||'GET';
   requests.push({resource:String(resource),method,headers:options.headers});
   let body=null;
   if(options.body)body=JSON.parse(options.body);
   if(method==='GET'&&endpoint.pathname.endsWith('/issues/1135/comments'))
     return Response.json(comments.filter(c=>c.updated_at>='2026-10-10T00:00:00Z'));
   if(method==='POST'&&endpoint.pathname.endsWith('/issues/1135/comments')) {
     const comment={id:nextId++,body:body.body,updated_at:'2026-10-10T15:10:00Z'};
     comments.push(comment);
     return Response.json(comment,{status:201});
   }
   if(method==='PATCH'&&endpoint.pathname.includes('/issues/comments/')) {
     const id=Number(endpoint.pathname.split('/').pop());
     const comment=comments.find(c=>c.id===id);
     if(!comment)return new Response('{}',{status:404});
     comment.body=body.body;
     return Response.json(comment);
   }
   throw Error('Unexpected GitHub request: '+method+' '+endpoint.pathname);
 };
 return {comments,requests,fetchImpl};
}

test('receipt IDs never embed webhook URLs or tokens',()=>{
 const key=discordReceiptKey(url);
 assert.match(key,/^discord-[a-f0-9]{24}$/);
 assert.equal(key,discordReceiptKey(url));
 assert.notEqual(key,discordReceiptKey(url+'/different'));
 assert.doesNotMatch(key,/token|discord\.com/);
});

test('GitHub receipt claim is persistent, idempotent and does not disclose webhook',async()=>{
 const state=fakeGitHub();
 const opts={token:'ghu_fixture',repo:'killjoy00/mtg-ev-analyzer',issueNumber:1135,
   fetchImpl:state.fetchImpl};
 const ledger=createGithubReceiptLedger(opts);
 const channel=discordReceiptKey(url),day='2026-10-10';
 const claim=await ledger.claim(day,channel);
 assert.equal(claim.alreadyPosted,false);
 assert.equal(state.comments.length,1);
 assert.match(state.comments[0].body,/status: claimed/);
 assert.ok(!state.comments[0].body.includes(url));
 assert.ok(!state.comments[0].body.includes('token_ABC-def'));
 await assert.rejects(ledger.claim(day,channel),/manual reconciliation required/,
   'an unconfirmed delivery must not be sent again');
 await ledger.markPosted(day,channel,claim);
 assert.match(state.comments[0].body,/status: posted/);
 const duplicate=await createGithubReceiptLedger(opts).claim(day,channel);
 assert.equal(duplicate.alreadyPosted,true);
 assert.equal(state.comments.length,1,'second workflow attempts do not create another claim');
 assert.ok(!state.requests.some(req=>req.resource.includes('token_ABC-def')),
   'GitHub API URLs cannot contain secret webhook URLs');
});

test('ledger requires pinned protected repository and dedicated issue',()=>{
 for(const bad of [
  {token:'',repo:'killjoy00/mtg-ev-analyzer',issueNumber:1135},
  {token:'ghu_fixture',repo:'evil/repo',issueNumber:1135},
  {token:'ghu_fixture',repo:'killjoy00/mtg-ev-analyzer',issueNumber:123},
 ])assert.throws(()=>createGithubReceiptLedger(bad),/not configured/);
});
