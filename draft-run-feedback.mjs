import { escapeHtml as esc } from './html.mjs';
import {modelSupportLabel} from './draft-run-reveal.mjs';

export function trophyRevealSentence(answer) {
  if(answer?.historicalMatch)return 'You matched the trophy pick.';
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
    facts.record&&`This trophy draft finished ${facts.record.replace('–','-')}.`,
    facts.winRate!=null&&`The drafter wins about ${facts.winRate}% of their games on 17Lands.`,
    facts.rank&&`The trophy drafter reached ${facts.rank} rank.`,
  ].filter(Boolean);
}

// Keep source-drafter background behind the post-pick score explanation, not
// in the primary decision headline. The record is unrelated to card win rate.
export function trophyDrafterDetails(answer) {
  const lines=trophyDrafterSentences(trophyDrafterFacts(answer));
  const link=answer?.deckAvailable===true?'<button type="button" class="text-button run-deck-link" data-trophy-deck aria-haspopup="dialog">Click here to see the drafter’s deck.</button>':'';
  if(!lines.length&&!link)return '';
  return `<div class="run-trophy-record">${lines.length?`<p>${esc(lines[0])}${link?` ${link}`:''}</p>${lines.slice(1).map(line=>`<p>${esc(line)}</p>`).join('')}`:`<p>${link}</p>`}</div>`;
}

export function compactDraftRunFeedback(answer) {
  if(!answer||answer.historicalMatch)return '';
  return answer.selectedName?`You picked ${answer.selectedName}.`:'';
}

// Support is a relative model signal. Points remain the saved, version-pinned
// game scores; displaying a new explanation must never regrade an old run.
export function consensusFeedback(answer,context='') {
  if(!answer?.consensusName)return '';
  const ranking=[...(answer.ranking||[])].sort((a,b)=>Number(b.id===answer.historicalId)-Number(a.id===answer.historicalId)||Number(b.support)-Number(a.support));
  const name=card=>`<button type="button" class="text-button" data-zoom="${esc(card.id)}">${esc(card.name)}</button>`;
  return `<section class="run-consensus" aria-label="How scoring works">
    <p class="run-scoring-copy">Matching the trophy pick earns 100 points. Other picks earn up to 95, based on the model.</p>
    <p class="run-model-note">Support compares each card with the model’s top choice. It isn’t a win rate.</p>
    ${context}
    ${ranking.length?`<details class="run-consensus-all"><summary>Compare all ${ranking.length} cards</summary><div class="run-consensus-table-wrap"><table><caption>Model support is relative to the model’s top choice.<span data-peer-col hidden> Players’ picks shows how today’s players chose.</span></caption><thead><tr><th scope="col">Card</th><th scope="col">Model support</th><th scope="col">Score</th><th scope="col" data-peer-col hidden>Players’ picks</th></tr></thead><tbody>${ranking.map(card=>`<tr><th scope="row">${name(card)}${card.id===answer.selectedId?' · Your pick':''}${card.id===answer.historicalId?' · Trophy pick':''}</th><td>${modelSupportLabel(card.support,answer.consensusSupport)}</td><td>${Number(card.score)}</td><td data-peer-card="${esc(card.id)}" hidden></td></tr>`).join('')}</tbody></table></div></details>`:''}
  </section>`;
}
