import {escapeHtml as esc} from './html.mjs';
import {openCardViewer} from './card-viewer.mjs?v=2';

const events={PremierDraft:'Premier Draft',TradDraft:'Traditional Draft',PickTwoDraft:'Pick Two Draft'};
const mana=cost=>[...String(cost||'').matchAll(/\{([^}]+)\}/g)].map(([,symbol])=>`<span class="run-deck-mana ${/^[WUBRG]$/.test(symbol)?'mana-'+symbol:''}">${esc(symbol)}</span>`).join('');
const group=card=>/\bLand\b/.test(card.type_line)?'Lands':/\bCreature\b/.test(card.type_line)?'Creatures':'Other spells';

function deckMarkup(deck,context) {
  const draftUrl=deck.source?.draft_url;
  const draftLink=/^https:\/\/www\.17lands\.com\/draft\/[a-f0-9]{32}$/.test(draftUrl||'')?`<p class="run-deck-draft-link"><a href="${esc(draftUrl)}" target="_blank" rel="noopener noreferrer">View full draft on 17Lands</a></p>`:'';
  const earlier=new Set(context.priorNames||[]);
  const colors={W:'white',U:'blue',B:'black',R:'red',G:'green'};
  const names=value=>[...String(value||'')].map(c=>colors[c]).filter(Boolean).join(' and ');
  const colorText=names(deck.colors)+(deck.splash_colors?`, splashing ${names(deck.splash_colors)}`:'');
  const curve=Array(8).fill(0);
  for(const card of deck.deck)if(group(card)!=='Lands')curve[Math.min(7,Math.max(0,Math.floor(Number(card.mana_value)||0)))]+=card.count;
  const max=Math.max(1,...curve);
  const chart=`<div class="run-deck-curve" aria-label="Mana curve">${curve.map((count,value)=>`<div><span>${count||''}</span><i style="height:${Math.round(56*count/max)}px"></i><small>${value===7?'7+':value}</small></div>`).join('')}</div>`;
  const sections=['Creatures','Other spells','Lands'].map(label=>{
    const cards=deck.deck.filter(card=>group(card)===label).sort((a,b)=>Number(a.mana_value)-Number(b.mana_value)||a.name.localeCompare(b.name));
    if(!cards.length)return '';
    return `<section class="run-deck-group"><h3>${label}<span>${cards.reduce((sum,c)=>sum+c.count,0)}</span></h3>${cards.map(card=>`<div class="run-deck-row ${card.name===context.trophyName?'is-trophy':''}"><span>${card.count}</span><button class="text-button" type="button" data-deck-card="${esc(card.id)}">${esc(card.name)}${card.name===context.trophyName?'<em>Trophy pick</em>':earlier.has(card.name)?'<i>Earlier pick</i>':''}</button><span class="run-deck-cost" aria-label="${esc(card.mana_cost)}">${mana(card.mana_cost)}</span></div>`).join('')}</section>`;
  }).join('');
  const side=deck.sideboard.length?`<details class="run-deck-sideboard"><summary>Sideboard (${deck.sideboard.reduce((n,c)=>n+c.count,0)})</summary>${deck.sideboard.map(card=>`<div class="run-deck-row"><span>${card.count}</span><button type="button" class="text-button" data-deck-card="${esc(card.id)}">${esc(card.name)}</button></div>`).join('')}</details>`:'';
  return `<p class="run-deck-meta">${context.record?`<strong>${esc(context.record.replace('–','-'))}</strong> · `:''}${esc(events[deck.event_type]||deck.event_type)} · ${deck.size} cards</p>${colorText?`<p class="run-deck-colors">${esc(colorText[0].toUpperCase()+colorText.slice(1))}</p>`:''}${draftLink}${chart}${sections}${side}<p class="run-deck-source">Source: <a href="https://www.17lands.com/public_datasets" target="_blank" rel="noopener">17Lands public datasets</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></p><details class="run-deck-about"><summary>About this deck</summary><p>${esc(deck.source.note)}</p></details>`;
}

export function openTrophyDeck(load,context={}) {
  const existing=document.querySelector('.run-deck-dialog[open]');if(existing)return existing;
  const focus=document.activeElement,dialog=document.createElement('dialog');
  dialog.className='run-deck-dialog';dialog.setAttribute('aria-labelledby','run-deck-title');
  dialog.innerHTML='<div class="run-deck-heading"><h2 id="run-deck-title">Trophy Drafter’s Decklist</h2><button type="button" class="text-button" data-deck-close aria-label="Close decklist">×</button></div><div class="run-deck-body" aria-live="polite"><p role="status">Loading decklist…</p></div>';
  dialog.querySelector('[data-deck-close]').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{dialog.remove();if(focus?.isConnected)focus.focus();},{once:true});
  document.body.append(dialog);dialog.showModal();
  async function render() {
    const body=dialog.querySelector('.run-deck-body');
    body.innerHTML='<p role="status">Loading decklist…</p>';
    try {
      const deck=await load();if(!dialog.isConnected)return;
      body.innerHTML=deckMarkup(deck,context);
      const cards=new Map([...deck.deck,...deck.sideboard].map(card=>[card.id,card]));
      body.querySelectorAll('[data-deck-card]').forEach(button=>button.onclick=()=>openCardViewer(cards.get(button.dataset.deckCard)));
    } catch {
      if(!dialog.isConnected)return;
      body.innerHTML='<p role="alert">Couldn’t load the decklist.</p><button type="button" class="button secondary" data-deck-retry>Try again</button>';
      body.querySelector('[data-deck-retry]').onclick=render;
    }
  }
  void render();return dialog;
}
