import { getAuthSession, loadPatreonStatus } from '/growth-api.mjs';
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
      action = '<button class="button secondary" type="button" disabled>Checking access…</button>';
    } else if (state === 'unavailable' || mode.premium && membershipUnavailable) {
      action = '<button class="button secondary" type="button" disabled>Access unavailable</button>';
    } else if (!signedIn) {
      action = '<a class="button secondary" href="/?account=1">Sign in to practice</a>';
    } else if (!canStart) {
      action = '<button class="button secondary" type="button" data-practice-upgrade>Upgrade to Elite</button>';
    } else {
      action = `<a class="button ${mode.premium ? 'secondary' : 'primary'}" href="${mode.href}">${mode.cta}</a>`;
    }
    card.querySelector('.practice-card-action').innerHTML = action;
  }

  const note = hub.querySelector('[data-practice-note]');
  note.textContent = state === 'checking'
    ? 'Checking your practice access…'
    : state === 'unavailable'
      ? 'Your practice options will be available after your account can be checked.'
      : !signedIn
        ? 'Sign in or create a free account for unlimited regular Draft Runs. Elite adds Powered Cube and custom-set practice.'
        : source === 'apple'
          ? 'Elite is active through your Apple App Store subscription. All three practice modes are unlocked.'
          : elite
            ? 'Elite is active. All three practice modes are unlocked.'
            : membershipUnavailable
              ? 'Regular Draft Runs are available. Elite practice is unavailable until your membership can be checked.'
              : patreon?.connected
                ? 'Your Patreon account is connected. Upgrade to Elite to unlock Powered Cube and custom-set practice.'
                : 'Your free account includes unlimited regular Draft Runs. Elite adds Powered Cube and custom-set practice.';

  const error = hub.querySelector('[data-practice-error]');
  error.hidden = state !== 'unavailable' && !membershipUnavailable;
  error.querySelector('p').textContent = state === 'unavailable'
    ? 'Pack One could not check your account right now.'
    : membershipUnavailable ? 'Pack One could not check your Elite membership right now.' : '';
}

async function render() {
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
    const { beginEliteUpgrade } = await import('/growth.mjs?v=28');
    await beginEliteUpgrade({ source: 'practice_hub' });
  } finally {
    button.disabled = false;
  }
});

void render();
