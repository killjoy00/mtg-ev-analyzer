// Publication gates are operational policy, separate from score calibration.
export const CORPUS_GATE_VERSION='corpus-gates-v1';
export const CORPUS_THRESHOLDS=Object.freeze({qualifiedTrophies:50,usablePuzzles:200,sourcesPerPickBand:16,imageCoverage:1,metadataCoverage:1,maxQualifiedExclusionRate:.25,maxExclusionIncrease:.10,maxCalibrationError:.15,healthMaxAgeDays:7});
export function corpusGates(m) {
 const t=CORPUS_THRESHOLDS,g=[];
 const gate=(id,pass,actual,requirement)=>g.push({id,pass:pass===true,actual:actual??null,requirement});
 gate('archive',m.archiveValid,m.archiveValid,'Official archive checksum and expected schema verified');
 gate('version',m.versionValid,m.versionValid,'Current corpus and context model versions match');
 gate('qualified_trophies',m.qualifiedTrophies>=t.qualifiedTrophies,m.qualifiedTrophies,`At least ${t.qualifiedTrophies} qualified trophy trajectories`);
 gate('usable_puzzles',m.usablePuzzles>=t.usablePuzzles,m.usablePuzzles,`At least ${t.usablePuzzles} usable first-eight decisions`);
 gate('pick_coverage',m.minimumPickBandSources>=t.sourcesPerPickBand,m.minimumPickBandSources,`At least ${t.sourcesPerPickBand} distinct sources at every served pick in each medium/hard band; easy may fall back to medium`);
 gate('accounting',m.accountingValid,m.accountingValid,'Ledger, manifest and database totals agree');
 gate('trajectories',m.brokenTrajectories===0,m.brokenTrajectories,'No broken included source trajectories');
 gate('exclusions',Number.isFinite(m.qualifiedExclusionRate)&&m.qualifiedExclusionRate<=t.maxQualifiedExclusionRate&&(!Number.isFinite(m.previousQualifiedExclusionRate)||m.qualifiedExclusionRate-m.previousQualifiedExclusionRate<=t.maxExclusionIncrease),m.qualifiedExclusionRate,'Qualified trophy exclusion ≤25%; increase ≤10 percentage points against previous verification');
 gate('metadata',m.metadataCoverage>=t.metadataCoverage,m.metadataCoverage,'100% of included cards have identity, name and type metadata');
 gate('images',m.imageCoverage>=t.imageCoverage,m.imageCoverage,'100% of included cards have HTTPS image references');
 gate('support',m.invalidSupport===0,m.invalidSupport,'Finite probabilities in [0,1], normalized to within 0.01');
 gate('model_validation',m.validation?.heldout===true&&m.validation?.examples>=200&&Number.isFinite(m.validation?.logLoss)&&Number.isFinite(m.validation?.top1)&&Number.isFinite(m.validation?.meanRank)&&m.validation?.calibrationError<=t.maxCalibrationError,m.validation,'Source-held-out sample ≥200; log loss, top-1, mean rank and calibration reported; ECE ≤0.15');
 return {gate_version:CORPUS_GATE_VERSION,ready:g.every(x=>x.pass),gates:g,metrics:m};
}
export const CORPUS_TRANSITIONS=Object.freeze({Candidate:['Live','Retired'],Live:['Paused','Retired'],Paused:['Live','Retired'],Retired:[]});
