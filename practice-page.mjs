import { getAuthSession, loadPatreonStatus } from '/growth-api.mjs';

function practiceCard({label,title,description,href,cta,badge=null,locked=false,elite=false}) {
  const action=locked
    ? '<button class="button secondary" type="button" data-practice-upgrade>Upgrade to Elite</button>'
    : `<a class="button ${elite?'secondary':'primary'}" href="${href}">${cta}</a>`;
  return `<article class="practice-card${elite?' is-elite':''}${locked?' is-locked':''}">
    <div class="practice-card-top">
      <p class="practice-label">${label}</p>
      <span class="practice-badge">${badge|| (elite?'Elite':'Included')}</span>
    </div>
    <h2>${title}</h2>
    <p>${description}</p>
    <div class="practice-card-action">${action}</div>
  </article>`;
}

function signedOutMarkup() {
  return `<section class="practice-shell">
    <header class="practice-hero">
      <p class="kicker">Practice</p>
      <h1>Keep drafting.</h1>
      <p>Practice is available with a free Pack One account. Sign in or create one to start unlimited regular Draft Runs.</p>
    </header>
    <div class="practice-gate">
      <a class="button primary" href="/?account=1">Sign in or create an account</a>
      <a class="button secondary" href="/">Back to Dailies</a>
    </div>
  </section>`;
}

function practiceMarkup(patreon) {
  const capabilities=patreon?.capabilities||[];
  const elite=capabilities.includes('custom_corpus')&&capabilities.includes('unlimited_cube_practice');
  const membershipConnected=Boolean(patreon?.connected);
  const eliteNote=elite
    ? 'Elite is active. Powered Cube and custom-set practice are unlocked.'
    : membershipConnected
      ? 'Your Patreon account is connected. Upgrade to Elite to unlock both premium practice modes.'
      : 'Elite unlocks Powered Cube and custom-set practice.';
  return `<section class="practice-shell" data-practice-hub data-elite="${elite?'1':'0'}">
    <header class="practice-hero">
      <p class="kicker">Practice</p>
      <h1>Keep drafting.</h1>
      <p>Choose the kind of run you want. Practice gives you more reps without changing today’s fixed Daily challenges.</p>
    </header>
    <div class="practice-grid">
      ${practiceCard({
        label:'Free practice',
        title:'Regular Draft Run',
        description:'Eight-decision runs from real trophy drafts, included with your free account.',
        href:'/?game=draft-run',
        cta:'Start Draft Run',
        badge:'Unlimited',
      })}
      ${practiceCard({
        label:'Powered practice',
        title:'Powered Cube',
        description:'Eight decisions from Powered Cube trophy drafts, available whenever you want another run.',
        href:'/?game=draft-run&set=powered-cube',
        cta:'Start Powered Cube',
        locked:!elite,
        elite:true,
      })}
      ${practiceCard({
        label:'Custom practice',
        title:'Choose your sets',
        description:'Build a random eight-decision run from the regular sets you want to practice.',
        href:'/?game=draft-run&custom=1',
        cta:'Choose your sets',
        locked:!elite,
        elite:true,
      })}
    </div>
    <p class="practice-membership-note">${eliteNote}</p>
  </section>`;
}

async function render() {
  const app=document.querySelector('#app');
  if(!app)return;
  let account=null;
  try { account=await getAuthSession(); }
  catch {
    app.innerHTML=`<section class="practice-shell"><div class="practice-error"><p class="kicker">Practice</p><h1>Practice is temporarily unavailable.</h1><p>Pack One could not check your account right now.</p><button class="button primary" type="button" data-practice-retry>Try again</button><a class="button secondary" href="/">Back to Dailies</a></div></section>`;
    app.querySelector('[data-practice-retry]')?.addEventListener('click',()=>void render());
    return;
  }
  if(!account?.user) {
    app.innerHTML=signedOutMarkup();
    return;
  }
  let patreon={configured:false,connected:false,capabilities:[]};
  try { patreon=await loadPatreonStatus(); } catch {}
  app.innerHTML=practiceMarkup(patreon);
  app.querySelectorAll('[data-practice-upgrade]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    try {
      const { beginEliteUpgrade }=await import('/growth.mjs?v=6');
      await beginEliteUpgrade({source:'practice_hub'});
    } finally {
      button.disabled=false;
    }
  }));
}

void render();
