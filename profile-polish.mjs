import {onAppRender} from './render-lifecycle.mjs';
import { loadMyProfile } from './growth-api.mjs';

let installed = false;
let activePage = null;

function ensureStyles() {
  if (document.querySelector('link[data-profile-polish-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './profile-polish.css?v=2';
  link.dataset.profilePolishCss = '1';
  document.head.appendChild(link);
}

function hasLabel(strip, label) {
  return [...strip.querySelectorAll(':scope > div > span')].some((node) => node.textContent?.trim() === label);
}

function stat(label, value, detail = '') {
  const node = document.createElement('div');
  node.className = 'profile-snapshot-stat';
  node.innerHTML = `<span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}`;
  return node;
}

function ensureStrip(page) {
  let strip = page.querySelector('.profile-identity-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'profile-identity-strip';
    page.querySelector('.profile-scoreboard')?.insertAdjacentElement('afterend', strip);
  }
  strip.classList.add('profile-career-snapshot');
  if (!strip.querySelector('.profile-snapshot-heading')) {
    const heading = document.createElement('div');
    heading.className = 'profile-snapshot-heading';
    heading.innerHTML = '<span>Career snapshot</span><small>Primary play, up front.</small>';
    strip.prepend(heading);
  }
  return strip;
}

async function enhanceOwnProfile(page) {
  if (page.dataset.profilePolish === '1' || page.dataset.profilePolish === 'loading') return;
  if (!page.querySelector('#profile-home')) return; // Public profiles stay read-only and compact.
  page.dataset.profilePolish = 'loading';
  try {
    const profile = await loadMyProfile();
    if (!document.body.contains(page)) return;
    const strip = ensureStrip(page);
    const draftRun = (profile.by_mode || []).find((row) => row.mode === 'draft_run');
    const cube = profile.cube;

    if (Number(draftRun?.games || 0) > 0 && !hasLabel(strip, 'Draft Run')) {
      strip.append(stat('Draft Run', Number(draftRun.average_score || 0).toFixed(1), `${Number(draftRun.games)} games · ${Number(draftRun.best_score || 0)} best`));
    }
    if (Number(cube?.games || 0) > 0 && !hasLabel(strip, 'Powered Cube')) {
      strip.append(stat('Powered Cube', Number(cube.average_score || 0).toFixed(1), `${Number(cube.games)} runs · ${Number(cube.best_score || 0)} best`));
    }
    page.dataset.profilePolish = '1';
  } catch {
    page.dataset.profilePolish = 'error';
  }
}

function scan() {
  const page = document.querySelector('.player-profile-page');
  if (!page || page === activePage && page.dataset.profilePolish === '1') return;
  activePage = page;
  void enhanceOwnProfile(page);
}

export function installProfilePolish() {
  if(installed)return;installed=true;
  ensureStyles();onAppRender(scan);
}
