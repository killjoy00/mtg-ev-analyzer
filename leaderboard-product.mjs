import { onAppRender } from './render-lifecycle.mjs';
import { POWERED_CUBE_ID } from './cube-product.mjs';

export function leaderboardPresentation(setId) {
  const cube = setId === POWERED_CUBE_ID;
  return {
    environmentLabel: 'Environment',
    allLabel: 'Featured challenges',
    modeLabel: cube ? 'Cube Pack Run' : 'Full Pack',
    cube,
  };
}

function enhanceLeaderboard() {
  const setSelect = document.querySelector('#leader-set');
  const modeSelect = document.querySelector('#leader-mode');
  if (!setSelect || !modeSelect) return;

  const presentation = leaderboardPresentation(setSelect.value);
  const setLabel = setSelect.closest('label')?.querySelector('span');
  if (setLabel) setLabel.textContent = presentation.environmentLabel;

  const all = [...setSelect.options].find((option) => option.value === 'all');
  if (all) {
    all.textContent = presentation.allLabel;
    all.title = 'Ranked scores from the featured expansion challenge for each game day.';
  }

  const cubeOption = [...setSelect.options].find((option) => option.value === POWERED_CUBE_ID);
  if (cubeOption) cubeOption.textContent = 'Powered Cube';

  const top3 = [...modeSelect.options].find((option) => option.value === 'top3');
  const full = [...modeSelect.options].find((option) => option.value === 'full');
  if (full) full.textContent = presentation.modeLabel;

  if (top3) {
    top3.disabled = presentation.cube;
    top3.hidden = presentation.cube;
  }

  // Powered Cube has one ranked product: Cube Pack Run. If a user switches the
  // environment while Top 3 is selected, immediately move the existing app
  // state to the supported mode and let its normal change handler reload rows.
  if (presentation.cube && modeSelect.value !== 'full' && full) {
    modeSelect.value = 'full';
    queueMicrotask(() => modeSelect.dispatchEvent(new Event('change', { bubbles: true })));
  }
}

export function installLeaderboardProductLayer() {
  onAppRender(enhanceLeaderboard);
}
