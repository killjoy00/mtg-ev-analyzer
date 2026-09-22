// Component revisions extend inventory independently of the frozen model.
export const TRADITIONAL_COMPONENT_VERSION='traditional-premier-v3-v1';
export const TRADITIONAL_PHASE2_COMPONENT_VERSION='traditional-premier-v3-phase2-v1';
export const FROZEN_CONTEXT_MODEL_VERSION='strong-player-colour-stage-v3';
export const TRADITIONAL_V4_PHASE2_COMPONENT_VERSION='traditional-premier-v4-phase2-v1';
export const V4_CONTEXT_MODEL_VERSION='strong-player-colour-stage-v4';
export const TRADITIONAL_GATE_VERSION='traditional-puzzle-quality-v1';

export const CUBE_TRADITIONAL_COMPONENT_VERSION='traditional-cube-p2p7-v3-v1';
export const CUBE_TRADITIONAL_V4_COMPONENT_VERSION='traditional-cube-p2p7-v4-v1';

const COMPONENT_MODELS=Object.freeze({
 [TRADITIONAL_COMPONENT_VERSION]:FROZEN_CONTEXT_MODEL_VERSION,
 [TRADITIONAL_PHASE2_COMPONENT_VERSION]:FROZEN_CONTEXT_MODEL_VERSION,
 [CUBE_TRADITIONAL_COMPONENT_VERSION]:FROZEN_CONTEXT_MODEL_VERSION,
 [TRADITIONAL_V4_PHASE2_COMPONENT_VERSION]:V4_CONTEXT_MODEL_VERSION,
 [CUBE_TRADITIONAL_V4_COMPONENT_VERSION]:V4_CONTEXT_MODEL_VERSION,
});
export const modelVersionForComponent=v=>COMPONENT_MODELS[v]||null;
export const supportedComponent=v=>Boolean(modelVersionForComponent(v));

export function approvedTraditionalSource(p) {
 if(p?.set_id==='powered-cube')return [CUBE_TRADITIONAL_COMPONENT_VERSION,CUBE_TRADITIONAL_V4_COMPONENT_VERSION].includes(p?.corpus_version)&&p.pick_number>=2&&p.pick_number<=7;
 return [TRADITIONAL_COMPONENT_VERSION,TRADITIONAL_PHASE2_COMPONENT_VERSION,TRADITIONAL_V4_PHASE2_COMPONENT_VERSION].includes(p?.corpus_version)&&p.pick_number>=1&&p.pick_number<=8;
}
