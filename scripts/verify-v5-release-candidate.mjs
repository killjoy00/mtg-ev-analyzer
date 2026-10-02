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
