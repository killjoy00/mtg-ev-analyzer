// Deliberately invoked when reviewed corpus inputs change; never run by tests.
import fs from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {interestingDraftRunPuzzle,gradeDraftRunPick,eligiblePickForRound,selectDraftRunReroll} from '../draft-run.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalogBytes=fs.readFileSync('corpus/draft-run/catalog.json'),catalog=JSON.parse(catalogBytes);
const root='tests/fixtures/draft-run';fs.mkdirSync(root,{recursive:true});
const sets=[];
for(const set of catalog.sets) {
  const original=fs.readFileSync(`corpus/draft-run/${set.id}.json.gz`);
  if(sha(original)!==set.sha256)throw Error('Corpus checksum mismatch: '+set.id);
  const rows=JSON.parse(gunzipSync(original)).filter(interestingDraftRunPuzzle);
  const chosen=new Set();
  for(let pick=1;pick<=11;pick++)for(const source of [...new Set(rows.filter(p=>p.pick_number===pick).map(p=>p.source_draft_hash))].sort().slice(0,16))chosen.add(source);
  // Cube rerolls retain difficulty anchors; preserve the full small Cube pool
  // so rare anchors still have two valid independent replacements.
  if(set.id!=='powered-cube')for(let round=0;round<10;round++) {
    const source=rows.find(p=>chosen.has(p.source_draft_hash)&&eligiblePickForRound(round,p.pick_number,'mixed','balanced-v1'));
    if(!source)continue;
    const replacement=selectDraftRunReroll(rows,source,{type:'pack',round,seed:'all-sets',environment:'mixed',selectionVersion:'balanced-v1'});
    if(!replacement)throw Error(`Original corpus lacks replacement: ${set.id} round ${round+1}`);
    chosen.add(replacement.source_draft_hash);
  }
  const sources=set.id==='powered-cube'?[...new Set(rows.map(p=>p.source_draft_hash))]:[...chosen];
  if(sources.length<12)throw Error('Fixture needs at least twelve independent sources: '+set.id);
  const selected=rows.filter(p=>sources.includes(p.source_draft_hash));
  const bytes=gzipSync(JSON.stringify(selected),{level:9,mtime:0});
  fs.writeFileSync(`${root}/${set.id}.json.gz`,bytes);
  sets.push({...set,puzzles:selected.length,trophy_drafts:sources.length,sha256:sha(bytes),source_sha256:set.sha256});
}
fs.writeFileSync(`${root}/catalog.json`,JSON.stringify({...catalog,fixture_version:1,source_catalog_sha256:sha(catalogBytes),sets},null,2)+'\n');
const opening=JSON.parse(gunzipSync(fs.readFileSync(`${root}/msh.json.gz`))).find(p=>p.pick_number===1);
// Freeze accepted scores once rather than manufacturing expectations at test time.
fs.writeFileSync(`${root}/scoring-golden.json`,JSON.stringify({puzzle:opening,expected:opening.candidates.map(c=>({id:c.id,score:gradeDraftRunPick(opening,c.id).score}))},null,2)+'\n');
console.log(`Created ${sets.length} fixture environments; ${sets.reduce((n,s)=>n+s.puzzles,0)} decisions.`);
