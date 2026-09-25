import {calibratedSupports,supportSharpening} from '../draft-run.mjs';
export function probabilityMetrics(puzzles,corpusVersion) {
 const bins=Array.from({length:10},()=>({n:0,p:0,y:0}));
 let n=0,logLoss=0,rawLogLoss=0,top1=0,rank=0;
 return {
  add(p){
   const ranked=[...p.candidates].sort((a,b)=>b.model_probability-a.model_probability||a.id.localeCompare(b.id));
   const actual=ranked.findIndex(c=>c.id===p.historical_pick_id);if(actual<0)throw Error('Missing trophy pick');
   const calibrated=calibratedSupports(ranked,supportSharpening(corpusVersion));
   n++;logLoss-=Math.log(Math.max(1e-12,calibrated.get(p.historical_pick_id)));rawLogLoss-=Math.log(Math.max(1e-12,ranked[actual].model_probability));top1+=actual===0;rank+=actual+1;
   const confidence=calibrated.get(ranked[0].id),bin=bins[Math.min(9,Math.floor(confidence*10))];bin.n++;bin.p+=confidence;bin.y+=actual===0;
  },
  report(){return {examples:n,logLoss:n?logLoss/n:null,rawLogLoss:n?rawLogLoss/n:null,top1:n?top1/n:null,meanRank:n?rank/n:null,calibrationError:n?bins.reduce((a,b)=>a+Math.abs(b.p-b.y),0)/n:null,bins,supportExponent:supportSharpening(corpusVersion),probabilityBasis:'Frozen model display calibration; partial-credit score curve unchanged'};},
 };
}
// Retained payload order is arbitrary. Compare every available earlier decision
// with the matching position in each later pool; gaps never invent a source pick.
export function trajectoryHealth() {
 const sources=new Map();
 return {
  add(p){const rows=sources.get(p.source_draft_hash)||[];rows.push({pick:p.pick_number,historical:p.historical_pick_id,prior:p.prior_picks.map(c=>c.id),fingerprint:p.source_fingerprint});sources.set(p.source_draft_hash,rows);},
  fingerprintVariations(){return [...sources.values()].filter(rows=>new Set(rows.map(r=>r.fingerprint)).size>1).length;},
  errors(){let errors=0;for(const rows of sources.values()){
   rows.sort((a,b)=>a.pick-b.pick);const seen=new Set();
   for(let i=0;i<rows.length;i++){const row=rows[i];if(seen.has(row.pick)||row.prior.length!==row.pick-1)errors++;seen.add(row.pick);
    for(const earlier of rows.slice(0,i))if(row.prior[earlier.pick-1]!==earlier.historical||earlier.prior.some((card,index)=>row.prior[index]!==card)){errors++;break;}
   }
  }return errors;},
 };
}
export function matchesFrozenSourceAudit(manifest,audit) {
 return Boolean(audit&&audit.production_changed===false&&audit.loss_field_available&&audit.input_signature===manifest.input_signature&&audit.source_archive?.sha256===manifest.source_archive?.sha256&&audit.included_sources===manifest.included_trophies&&audit.archive_drafts===manifest.source_drafts);
}
