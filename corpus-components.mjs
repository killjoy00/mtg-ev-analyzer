// Component revisions extend inventory independently of the frozen model.
export const TRADITIONAL_COMPONENT_VERSION='traditional-premier-v3-v1';
export const FROZEN_CONTEXT_MODEL_VERSION='strong-player-colour-stage-v3';
export const TRADITIONAL_GATE_VERSION='traditional-puzzle-quality-v1';

export const CUBE_TRADITIONAL_COMPONENT_VERSION='traditional-cube-p2p7-v3-v1';
export function approvedTraditionalSource(p) {
 return p?.set_id==='powered-cube'
  ? p.corpus_version===CUBE_TRADITIONAL_COMPONENT_VERSION&&p.pick_number>=2&&p.pick_number<=7
  : p?.corpus_version===TRADITIONAL_COMPONENT_VERSION&&p.pick_number>=1&&p.pick_number<=8;
}
export const supportedComponent=v=>[TRADITIONAL_COMPONENT_VERSION,CUBE_TRADITIONAL_COMPONENT_VERSION].includes(v);
