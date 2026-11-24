import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const app='pro.packone.app', locale='en-US';
const slots={'seven-inch':'sevenInchScreenshots','ten-inch':'tenInchScreenshots'};
const names=['01-real-trophy-drafts.png','02-see-the-trophy-pick.png','03-eight-picks-one-score.png','04-three-new-dailies.png','05-same-picks-for-everyone.png','06-keep-practicing.png'];
const sizes={'seven-inch':[2160,1215],'ten-inch':[2880,1620]};
const hash=b=>createHash('sha256').update(b).digest('hex');
const request=JSON.parse(readFileSync('.github/google-play-tablet-screenshot-request.json','utf8'));
assert.equal(request.operation,'publish-reviewed-android-tablet-screenshots');
assert.equal(request.packageName,app);
assert.equal(request.language,locale);
assert.ok(Number.isSafeInteger(request.sourceRun)&&request.sourceRun>0);
assert.match(request.sourceHead,/^[a-f0-9]{40}$/);
assert.equal(request.visuallyReviewed,true);
assert.deepEqual(Object.keys(request.artifacts).sort(),Object.keys(slots).sort());
assert.deepEqual(Object.keys(request.images).sort(),Object.keys(slots).sort());
for(const size of Object.keys(slots)){
  const artifact=request.artifacts[size];
  assert.ok(Number.isSafeInteger(artifact.id)&&artifact.id>0);
  assert.equal(artifact.name,'pack-one-android-'+size+'-store-screenshots');
  assert.match(artifact.digest,/^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(request.images[size]).sort(),names);
  for(const name of names)assert.match(request.images[size][name],/^[a-f0-9]{64}$/);
}
assert.notEqual(request.artifacts['seven-inch'].id,request.artifacts['ten-inch'].id);
assert.equal(new Set(Object.values(request.images).flatMap(Object.values)).size,12,'Expected distinct device captures');
const mode=process.argv[2];
assert.ok(['source','verify','publish'].includes(mode),'Explicit source, verify or publish mode required');

if(mode==='source'){
  const repo=process.env.GITHUB_REPOSITORY;
  assert.equal(repo,'killjoy00/mtg-ev-analyzer');
  const api=p=>JSON.parse(execFileSync('gh',['api',p],{encoding:'utf8'}));
  const run=api('/repos/'+repo+'/actions/runs/'+request.sourceRun);
  assert.equal(run.id,request.sourceRun);
  assert.equal(run.head_sha,request.sourceHead);
  assert.equal(run.conclusion,'success');
  assert.equal(run.path,'.github/workflows/android-tablet-store-captures.yml');
  assert.equal(run.head_repository.full_name,repo);
  for(const size of Object.keys(slots)){
    const expected=request.artifacts[size];
    const artifact=api('/repos/'+repo+'/actions/artifacts/'+expected.id);
    assert.equal(artifact.id,expected.id);
    assert.equal(artifact.name,expected.name);
    assert.equal(artifact.digest,expected.digest);
    assert.equal(artifact.workflow_run.id,request.sourceRun);
    assert.equal(artifact.expired,false);
  }
  console.log('Verified two exact successful native tablet capture artifacts.');
  process.exit(0);
}

const expectedPng=Buffer.from([137,80,78,71,13,10,26,10]);
const bytes={};
let apkHash;
for(const size of Object.keys(slots)){
  const root='reviewed-tablets/'+size;
  const manifest=JSON.parse(readFileSync(root+'/evidence/manifest.json','utf8'));
  assert.equal(manifest.capture_passed,true);
  assert.equal(manifest.source_sha,request.sourceHead);
  assert.equal(manifest.device_family,size);
  assert.equal(manifest.package,'pro.packone.preview');
  assert.equal(manifest.orientation,'landscape');
  assert.equal(manifest.physical_device,false);
  assert.match(manifest.apk_sha256,/^[a-f0-9]{64}$/);
  if(apkHash)assert.equal(manifest.apk_sha256,apkHash,'Device builds differ');
  apkHash=manifest.apk_sha256;
  assert.equal(manifest.scenes.length,6);
  assert.deepEqual(readdirSync(root+'/screenshots').sort(),names);
  bytes[size]={};
  for(const name of names){
    const data=readFileSync(root+'/screenshots/'+name);
    const scene=manifest.scenes.find(s=>s.name+'.png'===name);
    assert.ok(scene,'Missing native capture evidence: '+name);
    assert.equal(hash(data),request.images[size][name]);
    assert.equal(scene.sha256,hash(data));
    assert.ok(data.subarray(0,8).equals(expectedPng));
    assert.equal(data.toString('ascii',12,16),'IHDR');
    assert.deepEqual([data.readUInt32BE(16),data.readUInt32BE(20)],sizes[size]);
    assert.deepEqual(scene.dimensions,sizes[size]);
    assert.equal(data[24],8,'8-bit PNG required');
    assert.equal(data[25],2,'24-bit RGB PNG without alpha required');
    assert.ok(data.length>50_000&&data.length<=8_000_000);
    const raw=readFileSync(root+'/evidence/'+scene.name+'.raw.png');
    assert.equal(hash(raw),scene.raw_sha256);
    const xml=readFileSync(root+'/evidence/'+scene.name+'.xml','utf8');
    assert.ok(xml.includes('pro.packone.preview'));
    assert.ok(!/isn.t responding|Close app|Unfortunately/i.test(xml));
    bytes[size][name]=data;
  }
}
console.log('Verified all 12 reviewed image checksums and native capture manifests.');
if(mode==='verify')process.exit(0);

const token=process.env.PLAY_ACCESS_TOKEN;
assert.ok(token,'Missing Google Play publisher token');
const approved=JSON.parse(readFileSync('.github/pack-one-approved-six-screenshots.json','utf8'));
const phone=Object.entries(approved.sha256).filter(([k])=>k.startsWith('google-play/')).sort(([a],[b])=>a.localeCompare(b)).map(([,h])=>h);
assert.equal(phone.length,6);
const feature=JSON.parse(readFileSync('.github/google-play-trophy-feature-request.json','utf8')).jpegSha256;
const icon='e44233fe8cab56f5de4f891bc04450411122b4c592d68228dd37f486de361640';
const base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+app;
const uploadBase='https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/'+app;
const api=async(p,method='GET',data)=>{
  const res=await fetch(base+p,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data,signal:AbortSignal.timeout(60000)});
  const raw=await res.text();
  if(!res.ok)throw Error(method+' '+p+' HTTP '+res.status+': '+raw.slice(0,600));
  return raw?JSON.parse(raw):{};
};
const open=async()=>{const {id}=await api('/edits','POST','{}');assert.ok(id);return id;};
const types=['icon','featureGraphic','tvBanner','phoneScreenshots','sevenInchScreenshots','tenInchScreenshots','tvScreenshots','wearScreenshots'];
const unchanged=types.filter(t=>!Object.values(slots).includes(t));
const fingerprint=list=>list.map(x=>[x.id,x.sha256]);
const capture=async(edit)=>{
  const root='/edits/'+edit;
  const listing=await api(root+'/listings/'+locale);
  assert.equal(listing.language,locale);
  assert.equal(listing.title,'Pack One: Draft Challenge');
  const images={};
  for(const type of types)images[type]=(await api(root+'/listings/'+locale+'/'+type)).images||[];
  const tracks=(await api(root+'/tracks')).tracks||[];
  tracks.sort((a,b)=>a.track.localeCompare(b.track));
  return {listing,images,tracks};
};
const protectedState=s=>{
  assert.deepEqual(s.images.phoneScreenshots.map(x=>x.sha256),phone,'Phone gallery changed');
  assert.deepEqual(s.images.icon.map(x=>x.sha256),[icon],'Icon changed');
  assert.deepEqual(s.images.featureGraphic.map(x=>x.sha256),[feature],'Feature graphic changed');
};
const sameProtected=(before,after)=>{
  protectedState(after);
  for(const type of unchanged)assert.deepEqual(fingerprint(before.images[type]),fingerprint(after.images[type]),'Unrelated media changed: '+type);
  for(const field of ['title','shortDescription','fullDescription','video'])assert.equal(before.listing[field],after.listing[field]);
  assert.deepEqual(before.tracks,after.tracks,'Release tracks changed');
};
const desired=(state)=>Object.keys(slots).every(size=>JSON.stringify(state.images[slots[size]].map(x=>x.sha256))===JSON.stringify(names.map(name=>request.images[size][name])));
const uploadedIds={};
let edit=null,verify=null,committed=false;
try{
  edit=await open();
  const before=await capture(edit);
  protectedState(before);
  if(desired(before)){
    console.log('PACK_ONE_TABLET_RECEIPT '+JSON.stringify({published:true,verified:true,alreadyPresent:true,sevenInch:6,tenInch:6,sourceRun:request.sourceRun}));
    process.exitCode=0;
  }else{
    // These two galleries were intentionally emptied. Never replace an unexpected asset.
    for(const slot of Object.values(slots))assert.equal(before.images[slot].length,0,'Unexpected existing tablet gallery: '+slot);
    for(const size of Object.keys(slots)){
      const slot=slots[size];
      uploadedIds[slot]=[];
      for(const name of names){
        const png=bytes[size][name];
        const url=uploadBase+'/edits/'+edit+'/listings/'+locale+'/'+slot+'?uploadType=resumable';
        const init=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'X-Upload-Content-Type':'image/png','X-Upload-Content-Length':String(png.length),'Content-Length':'0'},body:'',signal:AbortSignal.timeout(60000)});
        const initBody=await init.text();
        if(!init.ok)throw Error('Tablet upload init HTTP '+init.status+': '+initBody.slice(0,500));
        const session=init.headers.get('location');
        assert.ok(session&&new URL(session).protocol==='https:','Invalid upload session');
        const put=await fetch(session,{method:'PUT',headers:{'Content-Type':'image/png','Content-Length':String(png.length)},body:png,signal:AbortSignal.timeout(90000)});
        const raw=await put.text();
        if(!put.ok)throw Error('Tablet upload HTTP '+put.status+': '+raw.slice(0,500));
        const image=JSON.parse(raw).image;
        assert.ok(image?.id,'Provider did not return image ID');
        uploadedIds[slot].push(image.id);
      }
    }
    const pending=await capture(edit);
    sameProtected(before,pending);
    assert.ok(desired(pending),'Pending tablet screenshot order/hash mismatch');
    for(const slot of Object.values(slots))assert.deepEqual(pending.images[slot].map(x=>x.id),uploadedIds[slot]);
    await api('/edits/'+edit+':commit','POST','{}');
    committed=true;
    edit=null;
    verify=await open();
    const after=await capture(verify);
    sameProtected(before,after);
    assert.ok(desired(after),'Committed tablet gallery order/hash mismatch');
    for(const slot of Object.values(slots))assert.deepEqual(after.images[slot].map(x=>x.id),uploadedIds[slot]);
    const receipt={published:true,verified:true,packageName:app,locale,sourceRun:request.sourceRun,sevenInch:6,tenInch:6,phoneScreenshotsUnchanged:6,featureGraphicUnchanged:true,iconUnchanged:true,listingCopyUnchanged:true,tracksUnchanged:true};
    console.log('PACK_ONE_TABLET_RECEIPT '+JSON.stringify(receipt));
    if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Google Play tablet screenshot publication\n\nCommitted and read back six 7-inch and six 10-inch native screenshots in approved order. Existing phone images, feature graphic, icon, listing copy and tracks verified unchanged.\n');
  }
}finally{
  if(edit&&!committed)await api('/edits/'+edit,'DELETE').catch(e=>console.error('Unable to discard pending edit',e));
  if(verify)await api('/edits/'+verify,'DELETE').catch(e=>console.error('Unable to discard verification edit',e));
}
