import { ACCOUNT_SIGNAL_KEY, getAuthSession, loadPatreonStatus } from '/growth-api.mjs';
import { eliteSource } from '/membership-source.mjs';

const modes = {
  regular: { href: '/?game=draft-run', cta: 'Start Draft Run', premium: false },
  cube: { href: '/?game=draft-run&set=powered-cube', cta: 'Start Powered Cube', premium: true },
  custom: { href: '/?game=draft-run&custom=1', cta: 'Choose your sets', premium: true },
};
let generation = 0;

function updateAccess({ state = 'checking', patreon = null, membershipUnavailable = false } = {}) {
  const hub = document.querySelector('[data-practice-hub]');
  if (!hub) return;
  const signedIn = state === 'signed-in';
  // Membership can come from Patreon, Apple, or another account grant.
  // The server continues to enforce access when a run starts.
  const source = signedIn ? eliteSource(patreon) : null;
  const elite = Boolean(source);
  hub.dataset.accountState = state;
  hub.dataset.elite = elite ? '1' : '0';
  hub.setAttribute('aria-busy', String(state === 'checking'));

  for (const card of hub.querySelectorAll('[data-practice-mode]')) {
    const mode = modes[card.dataset.practiceMode];
    const canStart = signedIn && (!mode.premium || elite);
    card.classList.toggle('is-locked', !canStart);
    let action;
    if (state === 'checking') {
      action = '<button class="button secondary" type="button" disabled>Checking membership…</button>';
    } else if (state === 'unavailable' || mode.premium && membershipUnavailable) {
      action = '<button class="button secondary" type="button" disabled>Membership unavailable</button>';
    } else if (!canStart) {
      action = mode.premium
        ? '<button class="button secondary" type="button" data-practice-upgrade>Upgrade to Elite</button>'
        : '<a class="button primary" href="/?account=1">Sign in to practice</a>';
    } else {
      action = `<a class="button ${mode.premium ? 'secondary' : 'primary'}" href="${mode.href}">${mode.cta}</a>`;
    }
    card.querySelector('.practice-card-action').innerHTML = action;
  }

  const note = hub.querySelector('[data-practice-note]');
  note.hidden = state === 'unavailable';
  note.textContent = state === 'checking'
    ? 'Checking your membership…'
    : state === 'unavailable'
      ? ''
      : !signedIn
        ? 'Sign in for unlimited regular Draft Runs. Elite also lets you practice Cube and choose your sets.'
        : source === 'apple'
          ? 'Elite is active through Apple.'
          : elite
            ? 'Elite is active.'
            : membershipUnavailable
              ? 'You can still play regular Draft Runs.'
              : patreon?.connected
                ? 'Your Patreon account is connected. Upgrade to Elite to unlock Powered Cube and custom-set practice.'
                : 'Your free account includes unlimited regular Draft Runs. Elite adds Cube and a choice of sets.';

  const error = hub.querySelector('[data-practice-error]');
  error.hidden = state !== 'unavailable' && !membershipUnavailable;
  error.querySelector('p').textContent = state === 'unavailable'
    ? 'Couldn’t check your account. Try again.'
    : membershipUnavailable ? 'Couldn’t check your Elite membership. Try again.' : '';
}

async function render() {
  if (!document.querySelector('[data-practice-hub]')) return;
  const version = ++generation;
  updateAccess();
  let account;
  try { account = await getAuthSession(); }
  catch {
    if (version === generation) updateAccess({ state: 'unavailable' });
    return;
  }
  let patreon = null, membershipUnavailable = false;
  if (account?.user) {
    try { patreon = await loadPatreonStatus(); }
    catch { membershipUnavailable = true; }
  }
  if (version === generation) updateAccess({
    state: account?.user ? 'signed-in' : 'guest', patreon, membershipUnavailable,
  });
}

document.querySelector('[data-practice-retry]')?.addEventListener('click', () => void render());
document.querySelector('[data-practice-hub]')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-practice-upgrade]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const { beginEliteUpgrade } = await import('/growth.mjs?v=44');
    await beginEliteUpgrade({ source: 'practice_hub' });
  } finally {
    button.disabled = false;
  }
});

globalThis.addEventListener('packone-account-changed', () => void render());
globalThis.addEventListener('storage', event => {
  if (event.key === 'pack1-auth-session-v1' || event.key === ACCOUNT_SIGNAL_KEY || event.key === null) void render();
});

void render();
