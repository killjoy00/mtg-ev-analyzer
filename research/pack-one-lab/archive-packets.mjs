// Private archive preparation/cache. Fixed public inputs, no user data.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidates,renderResearchBrief} from './editorial.mjs';
import {articleHash} from '../../worker/lab-editorial.mjs';

export const SOURCE_KEY='fra-premier-pinned-20261029-v1';
const PREPARE=fileURLToPath(new URL('../../scripts/prepare_pack_one_lab.py',import.meta.url));
const fail=code=>{throw Error('lab-'+code);};
export function archivePackets(report){
  const result=candidates(report,{allCandidates:true});
  return result.candidates.map(f=>{
    const brief=renderResearchBrief(f);
    return {schema_version:1,id:f.id,series:f.series,headline:f.headline,set:f.set,unit:f.unit,
      cohort:f.cohort,metrics:f.picks.flatMap(r=>r.metrics.map(m=>({
        id:'p'+r.pick+'-'+m.label.replace(/[^a-z0-9]+/gi,'-').toLowerCase(),
        label:'P1P'+r.pick+' — '+m.label,numerator:m.numerator,denominator:m.denominator,percent:m.percent
      }))),
      limitations:[f.limitations,'Predefined comparisons from the pinned archive; unknown cards and incomplete trajectories are excluded. Results describe the offered alternatives, not all drafts.'],
      provenance:{attribution:brief.source,method:brief.method,archive:'https://www.17lands.com/public_datasets',hashes:brief.source_sha256},
      reference:brief.hypothetical_opening,theme:f.theme,triage_score:f.triage_score,
      kind:'trophy-pick-analysis',status:'draft-only'};
  });
}
export async function prepareReport({run=promisify(execFile)}={}){
  const dir=await mkdtemp(join(tmpdir(),'pack-one-lab-report-'));
  try{
    const output=join(dir,'evidence.json');
    // Child needs only the gate identity and a minimal process environment.
    // Do not forward database, AI or email credentials to the downloader.
    const names=['PATH','HOME','TMPDIR','TEMP','SystemRoot','GITHUB_ACTIONS','GITHUB_REF','GITHUB_REPOSITORY','GITHUB_WORKFLOW','PACK1_LAB_REVIEW_ENABLED'];
    const env=Object.fromEntries(names.filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
    await run('python3',[PREPARE,'--out',output],{env,timeout:12*60*1000,maxBuffer:65536});
    const raw=await readFile(output,'utf8');
    if(raw.length>2*1024*1024)fail('archive-report-size');
    const report=JSON.parse(raw);
    archivePackets(report); // strict evidence validation before any storage.
    return report;
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function cachedArchivePackets(query,{prepare=false,build=prepareReport}={}){
  const read=async()=>(await query('SELECT state,report,report_hash FROM pack1_lab_research WHERE source_key=$1',[SOURCE_KEY])).rows[0];
  let row=await read();
  if(row?.state==='ready'){
    if(!row.report||articleHash(row.report)!==row.report_hash)fail('archive-cache-hash');
    return {status:'ready',packets:archivePackets(row.report)};
  }
  if(!prepare)return {status:row?.state||'not_prepared',packets:[]};
  // Retry only after a full day; a crashed preparing lease may be reclaimed.
  // The outer worker also holds the exclusive advisory lock.
  const claim=await query(`INSERT INTO pack1_lab_research(source_key,state) VALUES($1,'preparing')
    ON CONFLICT(source_key) DO UPDATE SET state='preparing',attempted_at=now()
    WHERE pack1_lab_research.state IN ('failed','preparing') AND pack1_lab_research.attempted_at<now()-interval '24 hours'
    RETURNING source_key`,[SOURCE_KEY]);
  if(!claim.rows.length)return {status:row?.state||'not_prepared',packets:[]};
  let report,packets;
  try{report=await build();packets=archivePackets(report);}
  catch{
    await query("UPDATE pack1_lab_research SET state='failed',report=NULL,report_hash=NULL WHERE source_key=$1 AND state='preparing'",[SOURCE_KEY]);
    return {status:'failed',packets:[]};
  }
  const saved=await query(`UPDATE pack1_lab_research SET state='ready',report=$2::jsonb,report_hash=$3
    WHERE source_key=$1 AND state='preparing' RETURNING source_key`,[SOURCE_KEY,JSON.stringify(report),articleHash(report)]);
  if(saved.rows.length!==1)fail('archive-cache-write');
  return {status:'ready',packets};
}
