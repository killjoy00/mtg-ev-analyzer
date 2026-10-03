import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import modelVersions from '../model-versions.json' with {type:'json'};

const root=process.argv[2]||'generated/v5-candidate';
const expectedRun=String(process.argv[3]||'');
if(!/^[1-9][0-9]{4,20}$/.test(expectedRun))throw Error('Expected a numeric v5 rebuild run ID.');

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=dir=>{
  const out={};
  const walk=current=>{
    for(const entry of fs.readdirSync(current,{withFileTypes:true})) {
      const full=path.join(current,entry.name);
      if(entry.isDirectory())walk(full);
      else if(entry.isFile()&&entry.name!=='checkpoint.json')out[path.relative(dir,full).split(path.sep).join('/')]=digest(full);
    }
  };
  walk(dir);
  return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));
};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

const identity=read(path.join(root,'v5-artifact-identity.json'));
const release=read('research/v5-validated-release.json');
if(String(identity.run_id)!==expectedRun||String(release.run_id)!==expectedRun)throw Error('Candidate run ID does not match the reviewed release record.');
if(identity.commit!==release.commit||identity.build_identity!==release.build_identity)throw Error('Candidate identity differs from the reviewed generated release.');
if(release.corpus_version!==modelVersions.v5.corpus_version||release.model_version!==modelVersions.v5.model_version)throw Error('Reviewed release is not the v5/v9 identity.');

const accounting=read('results/v5-rebuild/v5-rebuild-accounting.json');
const qa=read('results/v5-rebuild/v5-rebuild-qa.json');
if(accounting.model_version!==modelVersions.v5.model_version||accounting.corpus_version!==modelVersions.v5.corpus_version||
   accounting.build_identity!==release.build_identity||Number(accounting.environments)!==32)
  throw Error('Reviewed rebuild accounting is not the exact 32-environment v5/v9 build.');
if(!Array.isArray(accounting.sets)||accounting.sets.length!==32||new Set(accounting.sets.map(s=>s.id)).size!==32)
  throw Error('Reviewed rebuild accounting does not contain 32 unique environments.');
for(const s of accounting.sets) {
  if(s.training_mode!=='all-qualified'||s.training_cap!==null)
    throw Error(s.id+': reviewed accounting is not uncapped all-qualified training.');
  if(Number(s.training_drafts)!==Number(s.qualified_training_drafts))
    throw Error(s.id+': uncapped v5 did not train every qualified training draft.');
  if(s.holdout!=='5-fold by draft_id')throw Error(s.id+': five-fold draft holdout drifted.');
}
if(Number(accounting.total_trained)!==Number(accounting.total_qualified))
  throw Error('Uncapped v5 total trained drafts do not equal total qualified training drafts.');

if(qa.schema!=='v5-rebuild-qa-v1'||qa.model_version!==modelVersions.v5.model_version||
   qa.corpus_version!==modelVersions.v5.corpus_version||Number(qa.environments)!==32||
   qa.mixed_identities!==false||Number(qa.invalid_numerical_outputs)!==0)
  throw Error('Reviewed v5 implementation QA is incomplete or invalid.');
if(!Array.isArray(qa.sets)||qa.sets.length!==32||new Set(qa.sets.map(s=>s.id)).size!==32)
  throw Error('Reviewed v5 QA does not contain 32 unique environments.');
const refreshed=qa.sets.filter(s=>s.source_refreshed).map(s=>s.id).sort();
if(!same(refreshed,['hob']))throw Error('Authorized source refresh set drifted: '+refreshed.join(','));
if(qa.sets.some(s=>s.cohort_changed&&s.id!=='hob'))
  throw Error('An unchanged-source environment changed qualification cohort.');
const accountingBySet=new Map(accounting.sets.map(s=>[s.id,s]));
for(const s of qa.sets) {
  const a=accountingBySet.get(s.id);
  if(!a||Number(s.v5_training)!==Number(a.training_drafts)||
     Number(s.qualified_training_drafts)!==Number(a.qualified_training_drafts))
    throw Error(s.id+': QA/accounting training counts disagree.');
}

for(const [key,dirName] of [['premier_files','v5-trophy-import'],['traditional_files','v5-traditional']]) {
  const expected=identity[key];
  if(!expected||typeof expected!=='object'||Array.isArray(expected))throw Error('Candidate identity is missing '+key+'.');
  const actual=files(path.join(root,dirName));
  if(!same(actual,Object.fromEntries(Object.entries(expected).sort(([a],[b])=>a.localeCompare(b))))) {
    const missing=Object.keys(expected).filter(k=>actual[k]!==expected[k]);
    const extra=Object.keys(actual).filter(k=>!(k in expected));
    throw Error(`Candidate bytes differ from identity for ${dirName}; changed=${missing.join(',')||'none'} extra=${extra.join(',')||'none'}`);
  }
}
console.log(JSON.stringify({verified:true,run_id:expectedRun,build_identity:identity.build_identity,commit:identity.commit,
  corpus_version:release.corpus_version,model_version:release.model_version,
  premier_files:Object.keys(identity.premier_files).length,traditional_files:Object.keys(identity.traditional_files).length}));
