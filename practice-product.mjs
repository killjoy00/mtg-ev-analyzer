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

export function practiceLaunchUrl({ origin = 'https://magic.planitnow.us/', setId, mode, seed = null } = {}) {
  if (!setId) throw new Error('Set Practice requires a set.');
  if (!['top3', 'full'].includes(mode)) throw new Error(`Unsupported practice mode: ${mode}`);
  const url = new URL(origin);
  url.searchParams.set('set', setId);
  url.searchParams.set('mode', mode);
  url.searchParams.set('seed', seed || freshSeed());
  return url.toString();
}

function updateHomeCopy(select) {
  const featured = featuredOption(select);
  if (!featured) return;
  const selected = standardOptions(select).find((option) => option.value === select.value) || featured;
  const label = select.closest('.set-bar')?.querySelector('label');
  if (label) label.childNodes[0].textContent = '';
  const fieldLabel = document.querySelector('label[for="set-select"]');
  if (fieldLabel) fieldLabel.textContent = 'Practice set';

  // Make the default choice explicit without turning the Daily Challenge into a set picker.
  for (const option of standardOptions(select)) {
    const original = option.dataset.practiceOriginalLabel || option.textContent;
    option.dataset.practiceOriginalLabel = original.replace(/^Featured\s*[—-]\s*/i, '');
    option.textContent = option === featured ? `Featured — ${option.dataset.practiceOriginalLabel}` : option.dataset.practiceOriginalLabel;
  }

  const meta = document.querySelector('#set-meta');
  if (meta) {
    const selectedName = selected.dataset.practiceOriginalLabel || selected.textContent;
    const featuredName = featured.dataset.practiceOriginalLabel || featured.textContent;
    meta.textContent = selected.value === featured.value
      ? `Default practice follows the featured environment (${featuredName}). Choose another set here to lock practice to it.`
      : `Set Practice locked to ${selectedName}. Daily Challenge still uses featured ${featuredName}.`;
  }

  const daily = document.querySelector('#daily-challenge .daily-kicker');
  if (daily && !daily.querySelector('[data-featured-environment]')) {
    const chip = document.createElement('span');
    chip.className = 'best-chip';
    chip.dataset.featuredEnvironment = '1';
    chip.textContent = `Featured · ${featured.dataset.practiceOriginalLabel || featured.textContent}`;
    daily.appendChild(chip);
  }

  const practiceHeading = document.querySelector('.mode-section-heading > p');
  if (practiceHeading) {
    const selectedName = selected.dataset.practiceOriginalLabel || selected.textContent;
    practiceHeading.textContent = selected.value === featured.value
      ? 'Unlimited practice in the featured environment. Choose a set above only when you want focused Set Practice.'
      : `Unlimited practice locked to ${selectedName}. Change the Practice set above when you want a different environment.`;
  }
}

function enhanceHome() {
  if (!document.querySelector('.home-intro')) return;
  const select = document.querySelector('#set-select');
  if (!select || select.dataset.practiceOnly === '1') {
    if (select) updateHomeCopy(select);
    return;
  }

  select.dataset.practiceOnly = '1';
  const selected = readPracticeSet(select);
  if (selected) select.value = selected;
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

  const daily = event.target.closest?.('[data-daily-mode]');
  if (daily && select) {
    const featured = featuredOption(select);
    if (featured) select.value = featured.value;
    return; // Existing Daily handlers now see the featured environment.
  }

  const modeButton = event.target.closest?.('[data-mode]');
  if (modeButton && document.querySelector('.home-intro') && select) {
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
  const query = params();
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
  onAppRender(enhanceHome);
}
