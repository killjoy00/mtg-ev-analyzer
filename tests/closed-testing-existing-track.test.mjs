import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const exists of [true, false]) test(`closed promotion ${exists ? 'uses the existing track and exact bundle' : 'refuses a missing track before publishing'}`, () => {
  const script = `
    import assert from 'node:assert/strict';
    process.env.PLAY_ACCESS_TOKEN='fixture';
    process.argv[2]='123456';process.argv[3]='production-access';
    const writes=[];
    globalThis.fetch=async(url,options)=>{
      const path=new URL(url).pathname;
      const method=options.method;
      let data={};
      if(method!=='GET')writes.push({path,method,body:options.body});
      if(path.endsWith('/edits')&&method==='POST')data={id:'edit'};
      else if(path.endsWith('/bundles'))data={bundles:[{versionCode:'123456'}]};
      else if(path.endsWith('/tracks')){
        assert.equal(method,'GET','promotion cannot create a track');
        data={tracks:${exists ? '[{track: "production-access"}]' : '[]'}};
      }else if(path.endsWith('/tracks/production-access')){
        assert.equal(method,'PUT');
        assert.deepEqual(JSON.parse(options.body).releases[0].versionCodes,['123456']);
      }else if(!/\\/edit(?::validate|:commit)?$/.test(path))throw Error('Unexpected provider request');
      return new Response(JSON.stringify(data),{status:200});
    };
    let failed=false;
    try{await import('./mobile/scripts/play-closed-release.mjs');}
    catch(error){failed=true;assert.match(error.message,/refusing to create a track/);}
    assert.equal(failed,${!exists});
    if(${!exists}){
      assert.equal(writes.some(x=>x.method==='PUT'||x.path.endsWith(':commit')),false);
      assert.equal(writes.at(-1).method,'DELETE','abandoned edit must be removed');
    }else assert.equal(writes.at(-1).path.endsWith(':commit'),true);
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});
