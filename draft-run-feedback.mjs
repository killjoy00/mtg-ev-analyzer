import { escapeHtml as esc } from './html.mjs';

export function trophyRevealSentence(answer) {
  if(answer?.historicalMatch)return 'You matched the trophy drafter.';
  return `The trophy drafter took ${answer?.historicalName||'another card'}.`;
}

const LEGACY_RECORD=/^went 7–([0-2])$/;
const LEGACY_WIN_RATE=/^has an? (\d{1,3})% win rate$/;
const LEGACY_RANK=/^reached (Mythic|Diamond) rank$/;

// Source-drafter background from a locked answer: the structured form, or the
// single display string saved with older answers. Null when nothing is known.
export function trophyDrafterFacts(answer) {
  const given=answer?.trophyDrafter;
  if(given&&typeof given==='object') {
    const record=/^7–[0-2]$/.test(String(given.record??''))?given.record:null;
    const rate=Number(given.winRate);
    const winRate=given.winRate!=null&&Number.isInteger(rate)&&rate>=50&&rate<=100?rate:null;
    const rank=given.rank==='Mythic'||given.rank==='Diamond'?given.rank:null;
    return record||winRate!=null||rank?{record,winRate,rank}:null;
  }
  const legacy=String(answer?.trophyRecord||'').trim();
  let match;
  if((match=LEGACY_RECORD.exec(legacy)))return {record:`7–${match[1]}`,winRate:null,rank:null};
  if((match=LEGACY_WIN_RATE.exec(legacy))) {
    const rate=Number(match[1]);
    return rate>=50&&rate<=100?{record:null,winRate:rate,rank:null}:null;
  }
  if((match=LEGACY_RANK.exec(legacy)))return {record:null,winRate:null,rank:match[1]};
  return null;
}

// 17Lands calls the archived figure the drafter's overall win rate, so it is
// not labeled as specific to this format, draft or card.
export function trophyDrafterSentences(facts) {
  if(!facts)return [];
  return [
    facts.record&&`This trophy draft finished ${facts.record}.`,
    facts.winRate!=null&&`17Lands reports the trophy drafter’s overall game win rate as about ${facts.winRate}%. It describes the drafter, not this draft or this card.`,
    facts.rank&&`The trophy drafter reached ${facts.rank} rank.`,
  ].filter(Boolean);
}

// Keep source-drafter background behind the post-pick score explanation, not
// in the primary decision headline. The record is unrelated to card win rate.
export function trophyDrafterDetails(answer) {
  const lines=trophyDrafterSentences(trophyDrafterFacts(answer));
  return lines.length?`<div class="run-trophy-record">${lines.map(line=>`<p>${esc(line)}</p>`).join('')}</div>`:'';
}

export function compactDraftRunFeedback(answer) {
  if (!answer || answer.historicalMatch) return '';
  const selectedName=String(answer.selectedName||'').trim();
  const withChoice=message=>selectedName
    ? `You chose ${selectedName}. ${message}`
    : message;
  if (answer.modelTargetDisagreement) return withChoice('The trophy drafter made an unusual choice relative to the model.');
  const score=Number(answer.score);
  if (Number.isFinite(score) && score>=85) return withChoice('A strongly supported alternative.');
  if (Number.isFinite(score) && score>=60) return withChoice('A plausible alternative.');
  return withChoice('The model found less support for this choice.');
}

// Only call with a locked answer. A support ratio is a comparative model
// signal, not the probability that a card is correct or its expected win rate.
export function consensusFeedback(answer) {
  if (!answer?.consensusName) return '';
  const leader = Number(answer.consensusSupport);
  const relative = support => support != null && Number.isFinite(Number(support)) && leader > 0
    ? `${Math.round(100 * Number(support) / leader)}%` : 'Unavailable';
  const ranking = [...(answer.ranking || [])].sort((a, b) => Number(b.id===answer.historicalId)-Number(a.id===answer.historicalId)||Number(b.support)-Number(a.support));
  const name = card => `<button type="button" class="text-button" data-zoom="${esc(card.id)}">${esc(card.name)}</button>`;
  const trophyName=answer.historicalName||ranking.find(c=>c.id===answer.historicalId)?.name;
  const modelLeader=[...(answer.ranking||[])].sort((a,b)=>Number(b.support)-Number(a.support))[0];
  const disagreement=(answer.consensusId||modelLeader?.id)!==answer.historicalId;
  return `<section class="run-consensus" aria-label="Trophy pick and model support">
    <h3>Model’s strongest choice: ${esc(answer.consensusName)}</h3>
    ${trophyName?`<p><strong>Trophy drafter: ${esc(trophyName)}: 100.</strong>${disagreement?`<br>Model’s strongest alternative: ${esc(answer.consensusName)}: 95. This was an excellent alternative according to the model; ${esc(trophyName)} was the choice in this successful trophy draft.`:''}</p>`:''}
    <p>${answer.historicalId&&answer.selectedId===answer.historicalId?'You matched the trophy pick.':`Your pick has ${relative(answer.selectedSupport)} of the leading model support.`} Matching the trophy drafter is the goal of this game: trophy matches earn 100 regardless of model support. Other choices receive partial credit, up to 95, based on how strongly the model supports them.</p>
    ${ranking.length ? `<ol class="run-consensus-leaders">${ranking.slice(0, 3).map(c => `<li>${name(c)} <span>${c.id===answer.historicalId?'Trophy pick · 100 points':`${relative(c.support)} of leader · ${Number(c.score)} points`}</span></li>`).join('')}</ol>
    <section class="run-consensus-all" aria-label="All choices by model support"><h4>Compare all ${ranking.length} choices</h4><div class="run-consensus-table-wrap"><table><caption>Model support relative to the leader. The trophy match earns 100; alternative points use a separate partial-credit curve.</caption><thead><tr><th scope="col">Card</th><th scope="col">Support</th><th scope="col">Points</th></tr></thead><tbody>${ranking.map(c => `<tr><th scope="row">${name(c)}${c.id === answer.selectedId ? ' · Your pick' : ''}${c.id === answer.historicalId ? ' · Trophy pick' : ''}</th><td>${c.id===answer.historicalId?'N/A':relative(c.support)}</td><td>${Number(c.score)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <p class="run-model-note">Model support reflects held-out strong-player choices. It does not establish a correct pick or predict a win rate.</p>
  </section>`;
}
