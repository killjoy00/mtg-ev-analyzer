import { makeGameSeed } from './gameplay.mjs';
import { onAppRender } from './render-lifecycle.mjs';

const PRACTICE_SET_KEY = 'pack1-practice-set-v1';
const CUBE_ID = 'powered-cube';

function freshSeed() {
  return makeGameSeed(globalThis.crypto?.randomUUID ? () => crypto.randomUUID() : null);
}

function params() {
  return new URLSearchParams(window.location.search);
}

function standardOptions(select) {
  return [...(select?.options || [])].filter((option) => option.value && option.value !== CUBE_ID);
}

function featuredOption(select) {
  return standardOptions(select)[0] || null;
}

function readPracticeSet(select) {
  const options = standardOptions(select);
  if (!options.length) return '';
  try {
    const saved = localStorage.getItem(PRACTICE_SET_KEY) || '';
    if (options.some((option) => option.value === saved)) return saved;
  } catch { /* local persistence is optional */ }
  return options[0].value;
}

function writePracticeSet(value) {
  try { localStorage.setItem(PRACTICE_SET_KEY, value); } catch { /* optional */ }
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

export function practiceLaunchUrl({ origin = 'https://packone.pro/', setId, mode, seed = null } = {}) {
  if (!setId) throw new Error('Set Practice requires a set.');
  if (!['top3', 'full'].includes(mode)) throw new Error(`Unsupported practice mode: ${mode}`);
  const url = new URL(origin);
  url.searchParams.set('set', setId);
  url.searchParams.set('mode', mode);
  url.searchParams.set('seed', seed || freshSeed());
  return url.toString();
}

function placePracticeSelector(select) {
  const bar = select.closest('.set-bar');
  const section = document.querySelector('.mode-section:not(.cube-mode-section)');
  const heading = section?.querySelector('.mode-section-heading');
  if (!bar || !section || !heading) return;
  bar.classList.add('practice-set-bar');
  if (bar.parentElement !== section || heading.nextElementSibling !== bar) {
    heading.insertAdjacentElement('afterend', bar);
  }
}

function updateHomeCopy(select) {
  const featured = featuredOption(select);
  if (!featured) return;
  const selected = standardOptions(select).find((option) => option.value === select.value) || featured;
  const fieldLabel = document.querySelector('label[for="set-select"]');
  setText(fieldLabel, 'Practice set');

  // Make the default choice explicit in the opening-pack practice picker.
  for (const option of standardOptions(select)) {
    const original = option.dataset.practiceOriginalLabel || option.textContent.replace(/^Featured\s*[—-]\s*/i, '');
    if (!option.dataset.practiceOriginalLabel) option.dataset.practiceOriginalLabel = original;
    const desired = option === featured ? `Featured — ${original}` : original;
    setText(option, desired);
  }

  const selectedName = selected.dataset.practiceOriginalLabel || selected.textContent;
  const meta = document.querySelector('#set-meta');
  const metaCopy = selected.value === featured.value
    ? 'Use the featured set, or choose another set for Top 3 practice.'
    : `Top 3 practice locked to ${selectedName}.`;
  setText(meta, metaCopy);

  const practiceHeading = document.querySelector('.mode-section:not(.cube-mode-section) .mode-section-heading > p');
  const practiceCopy = selected.value === featured.value
    ? 'Choose the three best starts from a real opening pack. Pick a set and play as many packs as you want.'
    : `Choose the three best starts from ${selectedName} opening packs.`;
  setText(practiceHeading, practiceCopy);
}

function enhanceHome() {
  if (!document.querySelector('.home-intro')) return;
  const select = document.querySelector('#set-select');
  if (!select) return;

  if (select.dataset.practiceOnly !== '1') {
    select.dataset.practiceOnly = '1';
    const requested = params().get('set');
    const selected = standardOptions(select).some((option) => option.value === requested)
      ? requested
      : readPracticeSet(select);
    if (selected && select.value !== selected) select.value = selected;
    if (selected === requested) writePracticeSet(selected);
  }
  placePracticeSelector(select);
  updateHomeCopy(select);
}

function cleanHomeUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function capturePractice(event) {
  const select = document.querySelector('#set-select');

  // The visible set control is practice-only. Prevent app.js from changing the
  // featured Daily state when someone selects a practice environment.
  if (event.type === 'change' && event.target?.id === 'set-select' && document.querySelector('.home-intro')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    writePracticeSet(event.target.value);
    updateHomeCopy(event.target);
    return;
  }

  if (event.type !== 'click') return;

  const query = params();
  const modeButton = event.target.closest?.('[data-mode]');
  const cleanHomeLaunch = !query.get('seed') && !query.get('daily') && !query.get('mode');
  if (modeButton && cleanHomeLaunch && document.querySelector('.home-intro') && select) {
    const featured = featuredOption(select);
    const chosen = standardOptions(select).find((option) => option.value === select.value) || featured;
    if (chosen && featured && chosen.value !== featured.value) {
      event.preventDefault();
      event.stopImmediatePropagation();
      writePracticeSet(chosen.value);
      window.location.href = practiceLaunchUrl({
        origin: `${window.location.origin}${window.location.pathname}`,
        setId: chosen.value,
        mode: modeButton.dataset.mode,
      });
    }
    return;
  }

  // A seeded non-Daily run is practice (including shared exact-pack links).
  // Returning home should always reconstruct the featured Daily state instead
  // of leaving app.js pointed at the practice set.
  if (query.get('seed') && !query.get('daily')) {
    const exit = event.target.closest?.('#brand-home, #quit-game, #top3-home, #summary-home');
    if (exit) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = cleanHomeUrl();
    }
  }
}

export function installPracticeProductLayer() {
  document.addEventListener('change', capturePractice, true);
  document.addEventListener('click', capturePractice, true);
  narrowHome?.addEventListener?.('change', enhanceHome);
  onAppRender(enhanceHome);
}
