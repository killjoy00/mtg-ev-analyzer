const grid = document.querySelector('#set-archive-grid');
const summary = document.querySelector('#set-archive-summary');
const specialSection = document.querySelector('#special-formats');
const specialGrid = document.querySelector('#special-format-grid');
const detailPages = new Set(['msh', 'sos', 'tmt', 'ecl']);

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function dateValue(entry) {
  const value = Date.parse(`${entry.data_date || ''}T00:00:00Z`);
  return Number.isFinite(value) ? value : 0;
}

function dateLabel(value) {
  if (!value) return 'Date not recorded';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function cohortLabel(entry) {
  if (entry.win_rate_cutoff) return `${Math.round(Number(entry.win_rate_cutoff) * 100)}%+ source win rate`;
  return entry.cohort_label || 'Experienced Arena-rank cohort';
}

function card(entry, { special = false } = {}) {
  const id = String(entry.id || '').toLowerCase();
  const seats = Number(entry.replay_count || 0).toLocaleString();
  const training = Number(entry.training_drafts || 0).toLocaleString();
  const practiceUrl = special
    ? `/?game=draft-run&set=${encodeURIComponent(id)}`
    : `/?modes=1&set=${encodeURIComponent(id)}#more-pack-one`;
  return `<article class="content-card set-catalog-card" data-set-id="${esc(id)}">
    <p class="kicker">Data through ${esc(dateLabel(entry.data_date))}</p>
    <h2>${esc(entry.name || id.toUpperCase())}</h2>
    <p>${seats} replay seats · ${esc(cohortLabel(entry))}${training !== '0' ? ` · ${training} training drafts` : ''}.</p>
    <div class="set-card-actions"><a href="${practiceUrl}">${special ? 'Play Cube Run' : 'Practice this set'}</a>${detailPages.has(id) ? `<a href="/sets/${encodeURIComponent(id)}/">Data notes</a>` : ''}</div>
  </article>`;
}

async function renderCatalog() {
  try {
    const response = await fetch('/data/catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    const catalog = await response.json();
    const entries = (catalog.sets || []).filter((entry) => !entry.is_fixture);
    const standard = entries
      .filter((entry) => entry.category !== 'special_mode' && !entry.hide_from_set_picker)
      .sort((a, b) => dateValue(b) - dateValue(a) || String(b.id).localeCompare(String(a.id)));
    const special = entries
      .filter((entry) => entry.category === 'special_mode' || entry.hide_from_set_picker)
      .sort((a, b) => dateValue(b) - dateValue(a));
    if (!standard.length) throw new Error('The catalog did not contain any playable sets.');

    grid.innerHTML = standard.map((entry) => card(entry)).join('');
    summary.innerHTML = `<div><strong>${standard.length}</strong><span>standard sets</span></div><div><strong>${esc(standard[0].name)}</strong><span>latest environment</span></div><div><strong>${esc(dateLabel(standard[0].data_date))}</strong><span>latest data date</span></div>`;
    if (special.length) {
      specialGrid.innerHTML = special.map((entry) => card(entry, { special: true })).join('');
      specialSection.hidden = false;
    }
  } catch (error) {
    grid.innerHTML = `<p class="set-archive-error">The current catalog could not be loaded. Open <a href="/?modes=1">Set Practice</a> to see the playable environments.</p>`;
  }
}

void renderCatalog();
