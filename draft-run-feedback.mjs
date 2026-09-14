import { escapeHtml as esc } from './html.mjs';

// Only call with a locked answer. A support ratio is a comparative model
// signal, not the probability that a card is correct or its expected win rate.
export function consensusFeedback(answer) {
  if (!answer?.consensusName) return '';
  const leader = Number(answer.consensusSupport);
  const relative = support => support != null && Number.isFinite(Number(support)) && leader > 0
    ? `${Math.round(100 * Number(support) / leader)}%` : 'Unavailable';
  const ranking = [...(answer.ranking || [])].sort((a, b) => Number(b.support) - Number(a.support));
  const name = card => `<button type="button" class="text-button" data-zoom="${esc(card.id)}">${esc(card.name)}</button>`;
  return `<section class="run-consensus" aria-label="Elite consensus">
    <h3>Elite consensus: ${esc(answer.consensusName)}</h3>
    <p>Your pick has ${relative(answer.selectedSupport)} of the leading model support.${answer.historicalMatch ? ' Matching the trophy pick earns 100 regardless of model support.' : ' Alternatives earn 95 × their share of the leader’s support, rounded.'}</p>
    ${ranking.length ? `<ol class="run-consensus-leaders">${ranking.slice(0, 3).map(c => `<li>${name(c)} <span>${relative(c.support)} of leader · ${Number(c.score)} points</span></li>`).join('')}</ol>
    <details><summary>Compare all ${ranking.length} choices</summary><table><caption>Model support relative to the leader; points include the trophy-match bonus.</caption><thead><tr><th scope="col">Card</th><th scope="col">Support</th><th scope="col">Points</th></tr></thead><tbody>${ranking.map(c => `<tr><th scope="row">${name(c)}${c.id === answer.selectedId ? ' · Your pick' : ''}${c.id === answer.historicalId ? ' · Trophy pick' : ''}</th><td>${relative(c.support)}</td><td>${Number(c.score)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    <p class="run-model-note">Model support reflects held-out strong-player choices. It does not establish a correct pick or predict a win rate.</p>
  </section>`;
}
