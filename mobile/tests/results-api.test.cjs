const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const session={playerToken:'fixture-player',accountToken:'fixture-account',accountUser:{id:'11111111-1111-4111-8111-111111111111'}};
function load(){
 let current=session;const calls=[];let response=async()=>({active:true,emailState:'off',excludePublications:false});
 const filename=path.join(process.cwd(),'src/api/results.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const prior=Module._load;
 Module._load=function(name,parent,main){
  if(name==='@/src/storage/session')return {readSession:async()=>current};
  if(name==='@/src/api/client')return {requestJson:async(path,options)=>{calls.push({path,options});return response();}};
  return prior.call(this,name,parent,main);
 };
 try{mod._compile(output,filename);}finally{Module._load=prior;}
 return {...mod.exports,calls,setSession:value=>{current=value;},setResponse:value=>{response=value;}};
}
test('results choices use native account credentials and the editing account identity',async()=>{
 const api=load();await api.resultsRequest(session);await api.resultsRequest(session,'settings:on');
 assert.equal(api.calls[0].path,'/growth/v1/mobile/account/results');
 assert.equal(api.calls[0].options.mobileAccountToken,session.accountToken);assert.equal(api.calls[0].options.mobileSessionToken,session.playerToken);
 assert.equal(api.calls[1].options.method,'PATCH');assert.deepEqual(api.calls[1].options.body,{action:'settings:on',expectedAccountId:session.accountUser.id});
});
test('signed-out and switched-account choices never reach the transport',async()=>{
 const api=load();for(const current of [null,{...session,accountToken:'different'},{...session,accountUser:{id:'different'}}]){
  api.setSession(current);await assert.rejects(api.resultsRequest(session,'settings:on'),/Account changed/);
 }assert.equal(api.calls.length,0);
});
test('a response arriving after account switching is discarded',async()=>{
 const api=load();let finish;api.setResponse(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=api.resultsRequest(session,'exclude:on');await new Promise(resolve=>setImmediate(resolve));
 api.setSession({...session,accountToken:'different'});finish({active:true});await assert.rejects(pending,/Account changed/);
});
