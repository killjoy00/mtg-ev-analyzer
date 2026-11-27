// Private, exploratory research leads only. No model, article writer or publication path.
import {centralDate} from '../../worker/lab-editorial.mjs';
export const DIGEST_KIND='ideas-digest-v1';
const METHOD='https://github.com/killjoy00/mtg-ev-analyzer/blob/main/research/pack-one-lab/README.md';
const ARCHIVE='https://www.17lands.com/public_datasets';
const HASH=/^[a-f0-9]{64}$/;
const SAFE=/^[^\u0000-\u001f<>]{1,160}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const COLOR={W:'white',U:'blue',B:'black',R:'red',G:'green'};
const retired=new Set(['Cruel Alliance','Undercover Skrull','Hexhaven Battalion','Trickster\'s Stratagem','S.H.I.E.L.D. Deployment Drone','Lakeshore Apothecary']);
const safe=s=>typeof s==='string'&&SAFE.test(s)&&!(/https?:\/\//i.test(s));
const rate=c=>c.picked/c.n;
const count=c=>c.picked.toLocaleString('en-US')+'/'+c.n.toLocaleString('en-US')+' ('+(100*rate(c)).toFixed(1)+'%)';
const enough=(c,min,total)=>c&&[c.n,c.picked,c.drafts].every(Number.isSafeInteger)&&c.picked>=0&&c.picked<=c.n&&c.drafts>=min&&c.drafts<=Math.min(c.n,total)&&c.n<=8*total;
const openingCell=(c,min,total)=>enough(c,min,total)&&c.n===c.drafts;
const deckCells=(c,total)=>openingCell(c?.['deck-all'],45,total)&&openingCell(c['deck-low'],18,total)&&openingCell(c['deck-high'],18,total)&&c['deck-low'].n+c['deck-high'].n===c['deck-all'].n&&c['deck-low'].picked+c['deck-high'].picked===c['deck-all'].picked;
const names=(a,b)=>a<b?-1:a>b?1:0;
const rank=(a,b)=>b.score-a.score||names(a.id,b.id);

export function admission(config,{event,schedule='',now=new Date(),attempt='1'}={}){
 if(!config||typeof config.enabled!=='boolean'||!(config.test_token===null||typeof config.test_token==='string'&&/^v[1-9]\d{0,2}$/.test(config.test_token))||config.enabled&&config.test_token!==null)throw Error('digest-config');
 if(String(attempt)!=='1')return null; // An ambiguous provider submission must not be replayed.
 const p=centralDate(now);
 if(event==='push'&&!config.enabled&&config.test_token)return {kind:'test',date:p.date,key:'ideas-digest-test-v1-'+config.test_token};
 if(event!=='schedule'||!config.enabled||p.weekday!=='Wed'||p.hour<8||p.hour>=12)return null;
 // Two UTC triggers; identify the one that corresponds to 8:17 Central even
 // if Actions started late. Only that trigger can send in a given week.
 const h=schedule==='17 13 * * 3'?13:schedule==='17 14 * * 3'?14:null;
 if(h===null)return null;
 const at=centralDate(new Date(p.date+'T'+String(h).padStart(2,'0')+':17:00Z'));
 if(at.date!==p.date||at.hour!==8)return null;
 return {kind:'weekly',date:p.date,key:DIGEST_KIND+'-'+p.date};
}

export function collectIdeas(report){
 if(report?.schema_version!==1||report.kind!=='stored-corpus'||!Array.isArray(report.sets)||report.sets.length>5)throw Error('digest-source');
 const out=[];
 for(const [setRank,raw] of report.sets.entries()){
  const total=raw.complete_drafts;
  if(!Number.isSafeInteger(total)||total<100||!safe(raw.set_name)||!(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.set_id))||!HASH.test(raw.source_snapshot_id||'')||!HASH.test(raw.draft_sha256||'')||!HASH.test(raw.game_sha256||''))continue;
  const f=raw.feature_research,cards=raw.card_research;
  if(f?.version!=='feature-v2'||f.complete!==total||f.known_offers<.8*8*total||!Array.isArray(f.cards)||cards?.version!==2||cards.complete!==total||!Array.isArray(cards.cards)||cards.known_stages?.[0]<.8*total)continue;
  const rows=f.cards.filter(r=>r.ambiguous===false&&safe(r.card?.name)&&COLOR[r.card.color]&&r.cells&& !retired.has(r.card.name));
  const old=new Map(cards.cards.filter(r=>r.ambiguous===false&&safe(r.name)).map(r=>[r.name,r]));
  const deck=HASH.test(raw.deck_sha256||'')&&raw.deck_game_sha256===raw.game_sha256;
  const push=(family,card,peer,title,evidence,follow,score)=>{
   const keys=[card.name,...(peer?[peer.name]:[])].sort(names);
   out.push({id:raw.set_id+'|'+family+'|'+keys.join('|'),family,set:raw.set_name,set_id:raw.set_id,cards:keys,title,evidence,follow,score:score+Math.max(0,5-setRank)*2,source_snapshot_id:raw.source_snapshot_id,draft_sha256:raw.draft_sha256,game_sha256:raw.game_sha256});
  };
  for(const row of rows){
   const c=row.card,x=row.cells,cl=COLOR[c.color],prev=old.get(c.name),lo=x['deck-low'],hi=x['deck-high'];
   const r=prev?.rare;
   // Are popular opening commons worth staying in a color for? Two distinct
   // populations; the rare-pack rate is not a deck inclusion denominator.
   if(deck&&c.rarity==='common'&&deckCells(x,total)&&r&&Number.isSafeInteger(r.n)&&Number.isSafeInteger(r.picked)&&r.n>=100&&r.n<=cards.rare_packs&&r.picked>=0&&r.picked<=r.n&&rate(r)>=.18&&rate(lo)<=.75&&rate(hi)-rate(lo)>=.24){
    push('opening-flexibility',c,null,'How hard should '+c.name+' pull you into '+cl+'?',
     'Trophy drafters opened with '+c.name+' in '+count(r)+' packs offering it alongside a nonland rare or mythic. In a separate matched group that first-picked it, '+count(lo)+' kept its name in the last recorded main deck when fewer than two of picks two through eight were ordinary mono-'+cl+' spells, versus '+count(hi)+' with two or more.',
     'Compare its deck inclusion with similarly priced '+cl+' first picks, especially those requiring more colored mana. Could a popular first pick be a poor reason to stay in a color? The two groups are observational, not a direct rare-versus-common or win-rate comparison.',
     65+30*(rate(hi)-rate(lo))+Math.min(r.n,300)/100);
   }
   // The peer is chosen by shared support, not by the observed effect.
   // Require a sizeable low-color contrast and a substantially smaller
   // contrast within the higher-color group.
   if(deck&&deckCells(x,total)&&Number.isFinite(c.mana)){
    const peer=rows.filter(y=>y!==row&&y.card.color===c.color&&y.card.rarity===c.rarity&&y.card.creature===c.creature&&Number.isFinite(y.card.mana)&&Math.abs(y.card.mana-c.mana)<=2&&deckCells(y.cells,total))
      .sort((a,b)=>Math.min(b.cells['deck-low'].n,b.cells['deck-high'].n)-Math.min(a.cells['deck-low'].n,a.cells['deck-high'].n)||b.cells['deck-all'].n-a.cells['deck-all'].n||names(a.card.name,b.card.name))[0];
    if(peer){
     const pl=peer.cells['deck-low'],ph=peer.cells['deck-high'],lowGap=Math.abs(rate(lo)-rate(pl)),highGap=Math.abs(rate(hi)-rate(ph));
     if(lowGap>=.18&&highGap<=.12&&lowGap-highGap>=.12){
      push('first-pick-retention',c,peer.card,'Which '+cl+' first pick is easier to keep when the draft changes?',
       c.name+': '+count(lo)+' included in the last recorded main deck with fewer than two subsequent mono-'+cl+' picks through pick eight; '+count(hi)+' with at least two. '+peer.card.name+': '+count(pl)+' and '+count(ph)+', respectively. These are matched trophy drafts of the two named first picks, not a head-to-head test.',
       'Compare mana requirements, deck roles and final color pairs. Does one card give you more flexibility to move away from your first pick? Earlier color counts do not establish the final colors or why the card was left out.',
       72+40*(lowGap-highGap)+Math.min(lo.n,pl.n)/100);
     }
    }
   }
   // Look for an association that persists or reverses after a color check,
   // not the uninformative fact that green drafters prefer green cards.
   const a=x['fresh-one'],b=x['prior-one'],d=x['fresh-many'],e=x['prior-many'];
   if(c.rarity==='common'&&enough(a,30,total)&&enough(b,15,total)&&enough(d,30,total)&&enough(e,15,total)){
    const g1=rate(b)-rate(a),g2=rate(e)-rate(d);
    if(Math.sign(g1)===Math.sign(g2)&&Math.min(Math.abs(g1),Math.abs(g2))>=.10&&Math.max(Math.abs(g1),Math.abs(g2))>=.15){
     const direction=g1<0?'less':'more';
     const legendary=typeof c.type==='string'&&/\bLegendary\b/.test(c.type);
     push('copy-choice',c,null,'Is another '+c.name+' really '+direction+' attractive?',
      'Among trophy-draft offers at picks four through eight with exactly one earlier mono-'+cl+' pick, '+count(a)+' selected '+c.name+' without a prior copy and '+count(b)+' with one. With at least two earlier mono-'+cl+' picks, the corresponding counts were '+count(d)+' and '+count(e)+'. The repeat association has the same direction in both color groups.',
      (legendary?'Test whether the legendary restriction changes how often drafters take another copy compared with comparable nonlegendary cards. ':'Test whether another copy is competing with a different role or fills a specific synergy need. ')+'Compare the actual alternatives at the same pick and, if possible, the other early cards. Repeated offers may share a draft; preference, pack alternatives and exact color counts may still explain the gap.',
      58+60*Math.min(Math.abs(g1),Math.abs(g2))+Math.min(b.drafts,e.drafts)/10);
    }
   }
   const short=x['curve-short'],full=x['curve-full'];
   if(c.creature===true&&c.mana===2&&openingCell(short,18,total)&&openingCell(full,18,total)&&Math.abs(rate(short)-rate(full))>=.15){
    push('curve',c,null,'Would you take '+c.name+' if you already had a two-drop?',
     'At the same fifth pick, with '+c.name+' and a same-color creature costing at least three offered and at least two earlier mono-'+cl+' spells, drafters selected it '+count(short)+' with no earlier same-color two-mana creature versus '+count(full)+' with one or more.',
     'Compare against the specific larger creature offered and look at the rest of the curve. This compares earlier curve needs at one pick, not first-versus-fifth picks. It does not isolate a causal curve effect.',
     75+45*Math.abs(rate(short)-rate(full))+Math.min(short.n,full.n)/100);
   }
  }
 }
 const seen=new Set();
 return out.sort(rank).filter(x=>!seen.has(x.id)&&(seen.add(x.id),true));
}
export function selectIdeas(ideas,priorIds=[],limit=5){
 if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('digest-limit');
 const used=new Set(priorIds),cards=new Set(),families=new Map(),selected=[];
 for(const idea of [...ideas].sort(rank)){
  if(used.has(idea.id)||(families.get(idea.family)||0)>=2||idea.cards.some(c=>cards.has(idea.set_id+'|'+c)))continue;
  selected.push(idea);used.add(idea.id);families.set(idea.family,(families.get(idea.family)||0)+1);
  for(const c of idea.cards)cards.add(idea.set_id+'|'+c);
  if(selected.length===limit)break;
 }
 return selected;
}
export function renderDigest(ideas,{kind,date}){
 if(!DAY.test(date||'')||!['test','weekly'].includes(kind)||!Array.isArray(ideas)||ideas.length>5)throw Error('digest-render');
 const subject='Pack One Lab ideas - '+(kind==='test'?'TEST ':'')+date;
 const body=[kind==='test'?'Test email: this is the actual scheduled research digest.':'Here are this week\'s possible articles.',
  ideas.length?'These are research leads, not finished articles. Pick one, or skip the week.':'No new leads met the evidence and diversity checks this week. Nothing needs to be written.',
  ...ideas.map((i,n)=>(n+1)+'. '+i.title+' ('+i.set+')\n'+i.evidence+'\nNext test: '+i.follow),
  'Source: 17Lands public PremierDraft data (CC BY 4.0), retained Pack One trophy drafts with complete first-eight histories. Exploratory selection, not statistical significance, causal evidence, or proof of correct picks. '+ARCHIVE+'\nMethod: '+METHOD,
  'This digest uses current retained archive snapshots, which may predate the current set. No article was written or published.'].join('\n\n');
 return {subject,text:body};
}
