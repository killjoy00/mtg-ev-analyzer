import { gradeTopThree, rankCandidates } from './scoring.mjs';
import { createShareChallenge, isLeaderboardConfigured, loadCommunityDistribution, loadShareChallenge } from './leaderboard.mjs';

const SHARE_URL = 'https://magic.planitnow.us/';
let fullPackSelections = [];
window.PACK1_CAPTURED_PICKS = fullPackSelections;

function esc(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

async function resolveSetId(setName) {
  try {
    const response = await fetch('./data/catalog.json', { cache: 'no-store' });
    const data = await response.json();
    return data.sets?.find((set) => String(set.name).toLowerCase() === String(setName).toLowerCase())?.id || String(setName || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 24);
  } catch { return String(setName || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 24); }
}

function playerName() {
  try { return localStorage.getItem('pack1-player-name-v1') || 'Pack Player'; } catch { return 'Pack Player'; }
}

function scrapeTop3() {
  const buttons = [...document.querySelectorAll('.card-choice')];
  if (!buttons.length || !document.querySelector('.top3-comparison')) return null;
  const cards = buttons.map((button) => {
    const footer = button.querySelector('.card-footer span')?.textContent || '';
    const probability = Number((footer.match(/([0-9.]+)%/)?.[1] || 0)) / 100;
    return {
      id: button.dataset.cardId,
      name: button.querySelector('.card-footer strong')?.textContent || button.dataset.cardId,
      image_url: button.querySelector('img')?.src || '',
      model_probability: probability,
      historical: /drafter pick/i.test(footer),
      userRank: Number(button.querySelector('.user-rank-badge')?.textContent || 0),
    };
  });
  const selectedIds = cards.filter((c) => c.userRank).sort((a,b)=>a.userRank-b.userRank).map((c)=>c.id);
  if (selectedIds.length !== 3) return null;
  const score = Number(document.querySelector('.score-orb strong')?.textContent || 0);
  const grade = document.querySelector('.grade-badge')?.textContent || '';
  const heading = document.querySelector('.game-heading .eyebrow')?.textContent || '';
  const parts = heading.split('·').map((v)=>v.trim());
  const daily = parts[0] === 'Daily Challenge';
  const date = daily ? parts[1] : null;
  const setName = daily ? parts[2] : parts[1];
  return {
    cards: cards.map(({historical,userRank,...card}) => card),
    historicalId: cards.find((c)=>c.historical)?.id || '',
    selectedIds, score, grade, setName: setName || 'Magic', daily, date,
  };
}

function boldTakeMarkup(result) {
  const ranked = rankCandidates(result.cards);
  const first = result.cards.find((c)=>c.id===result.selectedIds[0]);
  const rank = ranked.findIndex((c)=>c.id===result.selectedIds[0]) + 1;
  if (!first || rank <= 1) return '';
  return `<div class="bold-take"><span>Your boldest take</span><strong>${esc(first.name)} at #1</strong><small>Strong-player consensus had it #${rank}.</small></div>`;
}

async function imageBitmap(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch { return null; }
}

async function resultPng(result, compare = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f0e6'; ctx.fillRect(0,0,1200,630);
  ctx.fillStyle = '#1f2b25'; ctx.font = '700 34px system-ui'; ctx.fillText('PACK 1', 56, 68);
  ctx.font = '700 72px system-ui'; ctx.fillText(`${result.score}/100`, 56, 166);
  ctx.font = '700 32px system-ui'; ctx.fillText(`${result.grade} · ${result.setName}`, 60, 210);
  if (compare) { ctx.font='600 24px system-ui'; ctx.fillText(`${compare.name} ${compare.score}  vs  You ${result.score}`, 60, 252); }
  ctx.font = '600 22px system-ui'; ctx.fillText('YOUR TOP 3', 470, 66);
  const selected = result.selectedIds.map((id)=>result.cards.find((c)=>c.id===id)).filter(Boolean);
  const bitmaps = await Promise.all(selected.map((card)=>imageBitmap(card.image_url)));
  selected.forEach((card,index)=>{
    const x = 470 + index*225, y=88, w=190, h=265;
    ctx.fillStyle='#e7e1d4'; ctx.fillRect(x,y,w,h);
    if (bitmaps[index]) ctx.drawImage(bitmaps[index],x,y,w,h);
    ctx.fillStyle='#1f2b25'; ctx.font='700 18px system-ui';
    const name = card.name.length>20 ? `${card.name.slice(0,19)}…` : card.name;
    ctx.fillText(`${index+1}. ${name}`,x,y+292);
  });
  const consensus = rankCandidates(result.cards).slice(0,3);
  ctx.font='600 20px system-ui'; ctx.fillText('CONSENSUS', 60, 320);
  consensus.forEach((card,index)=>{ ctx.font='600 21px system-ui'; ctx.fillText(`${index+1}. ${card.name}`, 60, 360 + index*38); });
  ctx.font='600 22px system-ui'; ctx.fillText('Beat my Pack 1 → magic.planitnow.us', 60, 570);
  return new Promise((resolve)=>canvas.toBlob(resolve,'image/png',0.94));
}

async function shareTop3(button) {
  const result = scrapeTop3();
  if (!result) return;
  const original = button.textContent;
  button.disabled = true; button.textContent = 'Making challenge…';
  let url = result.daily && result.date
    ? `${SHARE_URL}?daily=${encodeURIComponent(result.date)}&set=${encodeURIComponent(await resolveSetId(result.setName))}&mode=top3`
    : SHARE_URL;
  if (isLeaderboardConfigured()) {
    try {
      const created = await createShareChallenge({
        setId: await resolveSetId(result.setName), setName: result.setName,
        pack: result.cards, historicalId: result.historicalId, selectedIds: result.selectedIds,
        displayName: playerName(),
      });
      url = `${SHARE_URL}?challenge=${created.id}`;
    } catch (error) { console.warn('Challenge creation failed', error); }
  }
  const blob = await resultPng(result);
  const text = `Pack 1 · ${result.setName}\n${result.score}/100 (${result.grade})\nBeat my Top 3.`;
  try {
    const file = blob ? new File([blob], 'pack1-result.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files:[file] })) await navigator.share({ title:'Pack 1', text, url, files:[file] });
    else if (navigator.share) await navigator.share({ title:'Pack 1', text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); button.textContent='Copied!'; }
  } catch (error) {
    if (error?.name !== 'AbortError') try { await navigator.clipboard.writeText(`${text}\n${url}`); button.textContent='Copied!'; } catch {}
  }
  setTimeout(()=>{ button.disabled=false; button.textContent=original; },1200);
}

async function addCommunity(result) {
  if (!result?.daily || !result.date || !isLeaderboardConfigured() || document.querySelector('.community-panel')) return;
  try {
    const data = await loadCommunityDistribution({ date: result.date, setId: await resolveSetId(result.setName), mode:'top3' });
    if (!data.total) return;
    const byId = new Map(result.cards.map((c)=>[c.id,c.name]));
    const panel = document.createElement('section'); panel.className='community-panel';
    panel.innerHTML = `<p class="eyebrow">Community so far · ${data.total} ${data.total===1?'player':'players'}</p><h3>What did everyone take first?</h3><div class="community-bars">${data.rows.slice(0,4).map((row)=>`<div><span>${esc(byId.get(row.card_id)||row.card_id)}</span><strong>${Math.round(row.pct*100)}%</strong><i style="width:${Math.max(2,row.pct*100)}%"></i></div>`).join('')}</div>`;
    document.querySelector('.top3-comparison')?.after(panel);
  } catch {}
}

function enhanceResult() {
  const result = scrapeTop3();
  if (!result) return;
  const button = document.querySelector('#share-top3');
  if (button) button.textContent = 'Challenge a friend';
  const reveal = document.querySelector('.reveal-panel');
  if (reveal && !reveal.querySelector('.bold-take')) {
    const markup = boldTakeMarkup(result);
    if (markup) reveal.querySelector('.top3-comparison')?.insertAdjacentHTML('afterend', markup);
  }
  const submission = window.PACK1_LAST_SUBMISSION;
  const status = document.querySelector('.challenge-status.saved');
  if (status && submission?.percentile && !status.dataset.percentile) {
    status.dataset.percentile='1';
    status.insertAdjacentHTML('beforeend', ` · <strong>Top ${submission.percentile}% today</strong>`);
  }
  void addCommunity(result);
}

function captureFullPack(event) {
  const submit = event.target.closest?.('#submit-pick');
  if (!submit) return;
  const heading = document.querySelector('.game-heading h1')?.textContent || '';
  const pickNumber = Number(heading.match(/Pick (\d+)/)?.[1] || 0);
  const selected = document.querySelector('.card-choice.selected')?.dataset.cardId;
  if (pickNumber === 1) { fullPackSelections = []; window.PACK1_CAPTURED_PICKS = fullPackSelections; }
  if (selected && pickNumber) fullPackSelections[pickNumber-1] = selected;
}

document.addEventListener('click', (event)=>{
  captureFullPack(event);
  const share = event.target.closest?.('#share-top3');
  if (share && document.querySelector('.top3-comparison')) {
    event.preventDefault(); event.stopImmediatePropagation(); void shareTop3(share);
  }
}, true);

new MutationObserver(()=>enhanceResult()).observe(document.querySelector('#app'), { childList:true, subtree:true });

function renderChallenge(pack) {
  const app = document.querySelector('#app');
  let selectedIds=[]; let revealed=false;
  const draw = () => {
    const result = revealed ? gradeTopThree(pack.pack, selectedIds, pack.historicalId) : null;
    app.innerHTML = `<section class="game-heading"><div><p class="eyebrow">Beat my Pack · ${esc(pack.setName)}</p><h1>${esc(pack.creator.displayName)} scored ${pack.creator.score}. Can you beat it?</h1><p class="game-instruction">Rank your three best starts before you see theirs.</p></div></section>
      <div class="pack-grid opening-pack">${pack.pack.map((card)=>{ const rank=selectedIds.indexOf(card.id)+1; return `<button class="card-choice ${rank?'ranked-choice':''}" data-challenge-card="${esc(card.id)}" ${revealed?'disabled':''}><div class="card-image-wrap"><div class="card-art-placeholder">${esc(card.name)}</div>${card.image_url?`<img class="card-image" src="${esc(card.image_url)}" alt="${esc(card.name)}">`:''}${rank?`<span class="user-rank-badge">${rank}</span>`:''}</div><div class="card-footer"><strong>${esc(card.name)}</strong></div></button>`; }).join('')}</div>
      ${revealed?`<section class="reveal-panel"><p class="eyebrow">Challenge complete</p><div class="versus-score"><div><span>${esc(pack.creator.displayName)}</span><strong>${pack.creator.score}</strong></div><b>VS</b><div><span>You</span><strong>${result.score}</strong></div></div><h2>${result.score>pack.creator.score?'You beat it.':result.score===pack.creator.score?'Dead even.':'Run it back.'}</h2><div class="button-row"><button class="button primary" id="reshare-challenge">Challenge someone else</button><button class="button secondary" id="challenge-home">Play Pack 1</button></div></section>`:`<div class="action-dock"><div><strong>${selectedIds.length===3?'Ranking ready.':`Pick #${selectedIds.length+1}.`}</strong><span>${selectedIds.length}/3 selected</span></div><button class="button primary" id="reveal-challenge" ${selectedIds.length===3?'':'disabled'}>Reveal matchup</button></div>`}`;
    if (!revealed) document.querySelectorAll('[data-challenge-card]').forEach((button)=>button.addEventListener('click',()=>{ const id=button.dataset.challengeCard; const i=selectedIds.indexOf(id); if(i>=0)selectedIds.splice(i,1); else if(selectedIds.length<3)selectedIds.push(id); draw(); }));
    document.querySelector('#reveal-challenge')?.addEventListener('click',()=>{revealed=true;draw();});
    document.querySelector('#challenge-home')?.addEventListener('click',()=>{window.location.href=SHARE_URL;});
    document.querySelector('#reshare-challenge')?.addEventListener('click', async ()=>{
      const result = gradeTopThree(pack.pack, selectedIds, pack.historicalId);
      const created = await createShareChallenge({ setId:pack.setId,setName:pack.setName,pack:pack.pack,historicalId:pack.historicalId,selectedIds,displayName:playerName() });
      const shareResult={cards:pack.pack,selectedIds,score:result.score,grade:result.grade,setName:pack.setName};
      const blob=await resultPng(shareResult,{name:pack.creator.displayName,score:pack.creator.score});
      const url=`${SHARE_URL}?challenge=${created.id}`; const text=`I scored ${result.score} on this Pack 1. Beat me.`;
      const file=blob?new File([blob],'pack1-result.png',{type:'image/png'}):null;
      if(file&&navigator.canShare?.({files:[file]})) await navigator.share({text,url,files:[file]}); else if(navigator.share) await navigator.share({text,url}); else await navigator.clipboard.writeText(`${text}\n${url}`);
    });
  };
  draw();
}

const challengeId = new URLSearchParams(location.search).get('challenge');
if (challengeId && /^[a-f0-9]{12}$/.test(challengeId) && isLeaderboardConfigured()) {
  const app = document.querySelector('#app');
  app.innerHTML='<section class="message-card"><p class="eyebrow">Loading challenge</p><h1>Opening the pack…</h1></section>';
  loadShareChallenge(challengeId).then(renderChallenge).catch((error)=>{ app.innerHTML=`<section class="message-card"><h1>Challenge unavailable.</h1><p>${esc(error.message)}</p><a class="button primary" href="${SHARE_URL}">Play Pack 1</a></section>`; });
}
