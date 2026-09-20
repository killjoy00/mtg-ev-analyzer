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
  return 'Experienced Arena-rank source cohort';
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function card(entry, { special = false } = {}) {
  const id = String(entry.set_id || '').toLowerCase();
  const practiceUrl = special
    ? '/?game=draft-run&set=powered-cube'
    : '/?game=draft-run';
  return `<article class="content-card set-catalog-card" data-set-id="${esc(id)}">
    <p class="kicker">Data through ${esc(dateLabel(entry.data_date))}</p>
    <h2>${esc(entry.set_name || id.toUpperCase())}</h2>
    <p>${formatNumber(entry.verified_decisions)} verified first-pack decisions · ${formatNumber(entry.qualified_trophy_drafts)} qualified Premier trophy drafts.</p>
    <p>${esc(cohortLabel(entry))}${entry.training_drafts ? ` · ${formatNumber(entry.training_drafts)} training drafts` : ''}.</p>
    <div class="set-card-actions"><a href="${practiceUrl}">${special ? 'Elite Cube Practice' : 'Play Draft Run'}</a>${detailPages.has(id) ? `<a href="/sets/${encodeURIComponent(id)}/">Data notes</a>` : ''}</div>
  </article>`;
}

async function renderCatalog() {
  try {
    const base = String(window.PACK1_API?.draftRunUrl || '').replace(/\/$/, '');
    if (!base) throw new Error('Draft Run API is not configured.');
    const response = await fetch(`${base}/v1/set-catalog`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    const catalog = await response.json();
    const entries = (catalog.sets || []).filter((entry) => entry && entry.set_id);
    const standard = entries
      .filter((entry) => entry.regular_run)
      .sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')) || String(a.set_id).localeCompare(String(b.set_id)));
    const special = entries
      .filter((entry) => !entry.regular_run)
      .sort((a, b) => dateValue(b) - dateValue(a) || String(a.set_id).localeCompare(String(b.set_id)));
    if (!standard.length) throw new Error('The serving catalog did not contain any playable sets.');

    grid.innerHTML = standard.map((entry) => card(entry)).join('');
    summary.innerHTML = `<div><strong>${standard.length}</strong><span>standard sets</span></div><div><strong>${esc(standard[0].set_name || standard[0].set_id.toUpperCase())}</strong><span>latest environment</span></div><div><strong>${esc(dateLabel(standard[0].data_date))}</strong><span>latest data date</span></div>`;
    if (special.length) {
      specialGrid.innerHTML = special.map((entry) => card(entry, { special: true })).join('');
      specialSection.hidden = false;
    }
  } catch (error) {
    grid.innerHTML = '<p class="set-archive-error">Current serving coverage could not be loaded. Open <a href="/?game=draft-run">Draft Run</a> to keep playing.</p>';
  }
}

void renderCatalog();
