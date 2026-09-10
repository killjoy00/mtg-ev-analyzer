import { onAppRender } from './render-lifecycle.mjs';

export const LEGACY_RANK_SETS = new Set(['vow', 'mid', 'stx']);

function currentSet() {
  return new URLSearchParams(globalThis.location?.search || '').get('set') || '';
}

export function legacyMethodCopy(text, setId = currentSet()) {
  if (!LEGACY_RANK_SETS.has(String(setId || '').toLowerCase())) return String(text || '');
  return String(text || '').replace(
    /high-win-rate drafts train the consensus model/i,
    'experienced, high-ranked Arena drafts train the consensus model',
  );
}

function enhanceLegacyMethodology() {
  const setId = currentSet();
  if (!LEGACY_RANK_SETS.has(setId.toLowerCase())) return;
  const note = document.querySelector('.method-details p');
  if (!note) return;
  const revised = legacyMethodCopy(note.textContent, setId);
  if (revised !== note.textContent) note.textContent = revised;
}

export function installLegacyCohortLayer() {
  onAppRender(enhanceLegacyMethodology);
}
