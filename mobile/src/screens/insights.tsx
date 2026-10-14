import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {safeCardImageUrl} from '../../../card-image-policy.mjs';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { AboutLink } from '@/src/components/AboutLink';
import { MyPackSectionTabs } from '@/src/components/MyPackSectionTabs';
import { loadMobileInsights, loadMobileInsightDecision, type DraftInsights, type DraftingDNA, type DnaTrait, type CardChoices, type DraftingJourney, type InsightHighlights, type InsightHighlight, type InsightDecisionLocator, type InsightDecision, type InsightCard, type InsightGroup, type InsightsEnvironment, type InsightsPeriod } from '@/src/api/insights';
import { ApiError } from '@/src/api/client';
import { ensureGuestSession } from '@/src/api/guest';
import { useAppResume } from '@/src/hooks/useAppResume';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';
import { config } from '@/src/config';

const environments: { value: InsightsEnvironment; label: string }[] = [
  { value: 'mixed', label: 'Mixed sets' }, { value: 'latest', label: 'Latest Set' }, { value: 'powered-cube', label: 'Powered Cube' },
];
const periods: { value: InsightsPeriod; label: string }[] = [
  { value: 'all', label: 'All available' }, { value: '90d', label: 'Last 90 days' }, { value: '365d', label: 'Last year' },
];
const identity = (session: MobileSession | null) => session
  ? JSON.stringify([session.playerToken, session.accountToken ?? '', session.subjectId ?? '', session.accountUser?.id ?? '']) : '';
const score = (value: number | null) => value === null ? '—' : Number(value).toFixed(1);
const num = (value: number) => Number(value || 0).toLocaleString();
const setNames:Record<string,string> = {"stx":"Strixhaven: School of Mages","mid":"Innistrad: Midnight Hunt","vow":"Innistrad: Crimson Vow","neo":"Kamigawa: Neon Dynasty","snc":"Streets of New Capenna","hbg":"Alchemy Horizons: Baldur's Gate","dmu":"Dominaria United","bro":"The Brothers' War","one":"Phyrexia: All Will Be One","sir":"Shadows over Innistrad Remastered","mom":"March of the Machine","ltr":"The Lord of the Rings: Tales of Middle-earth","woe":"Wilds of Eldraine","lci":"The Lost Caverns of Ixalan","ktk":"Khans of Tarkir","mkm":"Murders at Karlov Manor","otj":"Outlaws of Thunder Junction","mh3":"Modern Horizons 3","blb":"Bloomburrow","sos":"Secrets of Strixhaven","dsk":"Duskmourn: House of Horror","fdn":"Foundations","pio":"Pioneer Masters","dft":"Aetherdrift","tdm":"Tarkir: Dragonstorm","fin":"Final Fantasy","eoe":"Edge of Eternities","tla":"Avatar: The Last Airbender","hob":"The Hobbit","msh":"Marvel Super Heroes","tmt":"Teenage Mutant Ninja Turtles","ecl":"Lorwyn Eclipsed","fra":"Reality Fracture","powered-cube":"Powered Cube"};
const setName=(id:string)=>setNames[id?.toLowerCase()]||id?.toUpperCase()||'Unknown set';
function reviewExplanation(item:InsightHighlight) {
  if(item.trophy_match)return 'You matched the trophy pick.';
  const evidence=item.reason_evidence||{};
  if(item.reason_code==='saved-support-gap'&&
    typeof evidence.leader_id==='string'&&typeof evidence.leader_name==='string'&&
    evidence.leader_name.trim()&&evidence.leader_id!==(item.preview?.selected?.id||'')) {
    return evidence.leader_id===(item.preview?.trophy?.id||item.historical_id)
      ?'The saved model supported the trophy pick more strongly than your choice.'
      :'The saved model favored '+evidence.leader_name+' — a different card from the trophy pick.';
  }
  return 'You chose a different card.';
}
const safeFinding=(data:DraftInsights)=>{
  const finding=data.leading_finding;
  if(!['progress','pick-depth'].includes(finding?.id||''))return null;
  const examples=[...(data.highlights?.best||[]).slice(0,3),...(data.highlights?.misses||[]).slice(0,3)];
  return examples.some(item=>item.finding_context)?finding:null;
};

const shortDate = (value?:string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value||'';
  const n=Number(value.slice(5,7)),date=Number(value.slice(8,10));
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][n-1]+' '+date;
};

function shortJourneyRange(window:{from:string;to:string;from_at?:string;to_at?:string}) {
  const local=(timestamp:string|undefined,fallback:string)=>{
    if(!timestamp)return shortDate(fallback);
    const value=new Date(timestamp);
    return Number.isFinite(value.getTime())?
      value.toLocaleDateString(undefined,{month:'short',day:'numeric'}):shortDate(fallback);
  };
  const from=local(window.from_at,window.from),to=local(window.to_at,window.to);
  return from===to?from:from+'–'+to;
}

function ChoiceRow<T extends string>({ name, values, selected, onChange }: {
  name: string; values: { value: T; label: string }[]; selected: T; onChange: (value: T) => void;
}) {
  return <View style={styles.choiceGroup}>
    <Text style={styles.controlLabel}>{name}</Text>
    <View style={styles.choices}>
      {values.map(item => <Pressable key={item.value} accessibilityRole="button"
        accessibilityLabel={name + ': ' + item.label} accessibilityState={{ selected: selected === item.value }}
        onPress={() => onChange(item.value)}
        style={[styles.choice, selected === item.value && styles.choiceActive]}>
        <Text style={[styles.choiceText, selected === item.value && styles.choiceTextActive]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

function Section({ title, caption, children, compact=false, onLayout }: {
  title:string;caption?:string;children:React.ReactNode;compact?:boolean;onLayout?:()=>void;
}) {
  return <View style={[styles.section,compact&&styles.dnaSection]} onLayout={onLayout}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    {children}
  </View>;
}

function Metrics({ rows }: { rows: (InsightGroup & { label: string })[] }) {
  if (!rows.length) return <Text style={styles.caption}>No eligible decisions in this group yet.</Text>;
  return <View style={styles.metricList}>{rows.map((row, index) => <View key={row.label + index} style={styles.metric}>
    <View style={styles.metricHead}>
      <Text style={styles.metricName}>{row.label}</Text>
      <Text style={styles.metricScore}>{row.average_score === null ? 'Need 5 picks' : score(row.average_score) + ' / 100'}</Text>
    </View>
    <View accessibilityLabel={row.label + ', ' + row.count + ' decisions, ' +
      (row.average_score === null ? 'not enough to average' : score(row.average_score) + ' average points')}
      style={styles.track}>
      <View style={[styles.trackFill, { width: (Math.max(0, Math.min(100, Number(row.average_score ?? 0))) + '%') as '100%' }]} />
    </View>
    <Text style={styles.meta}>{num(row.count)} decisions</Text>
  </View>)}</View>;
}

function insightLocalRange(value:{from_at?:string;to_at?:string;from?:string;to?:string;date?:string}) {
  const local=(s?:string)=>{
    if(!s)return null;
    const date=new Date(s);
    return Number.isFinite(date.getTime())?date.toLocaleString(undefined,
      {year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):null;
  };
  const first=local(value.from_at),last=local(value.to_at);
  return first&&last?first+' to '+last:
    value.from&&value.to?value.from+' to '+value.to:value.date||value.to||'';
}

function DNATrait({trait}: {trait:DnaTrait}) {
  const [expanded,setExpanded]=useState(false);
  return <View style={styles.patternTrait}>
    <Text style={styles.patternTitle}>{trait.title}</Text>
    <Text style={styles.body}>{trait.summary}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{expanded}}
      style={styles.dnaDisclosure} onPress={()=>setExpanded(v=>!v)}>
      <Text style={styles.summary}>{expanded?'Hide evidence':'Why this fits'}</Text>
    </Pressable>
    {expanded?<View style={styles.evidence}>
      <Text style={styles.caption}>{num(trait.supporting_decisions)} picks included in this pattern.</Text>
      {(trait.evidence||[]).map((entry,index)=><Text key={entry.label+index} style={styles.caption}>
        {entry.label}: {String(entry.value)}
      </Text>)}
    </View>:null}
  </View>;
}
function DNASummary({dna,cardChoices,onReview}:{
  dna:DraftingDNA;cardChoices?:CardChoices;onReview:(item:InsightDecisionLocator)=>void;
}) {
  const [showRules,setShowRules]=useState(false);
  const [showChoices,setShowChoices]=useState(false);
  const [expandedChoices,setExpandedChoices]=useState<string[]>([]);
  const traits=[dna.primary,...(dna.secondary||[])].filter((trait):trait is DnaTrait=>
    trait?.status==='qualified');
  const qualified=[...new Map(traits.map(trait=>[trait.id,trait])).values()];
  const ready=(cardChoices?.choices||[]).filter(choice=>choice.status==='ready');
  return <Section title="Your pick patterns" caption="Across formats · All available history" compact>
    {qualified.length?qualified.map(trait=><DNATrait key={trait.id} trait={trait}/>):
      <Text style={styles.caption}>No clear pick pattern to show yet.</Text>}
    {ready.length?<View style={styles.contextWrap}>
      <Pressable accessibilityRole="button" accessibilityState={{expanded:showChoices}}
        style={styles.disclosure} onPress={()=>setShowChoices(v=>!v)}>
        <Text style={styles.summary}>Card type and rarity counts</Text>
      </Pressable>
      {showChoices?<View style={styles.evidence}>
        <Text style={styles.caption}>These counts only include packs where both categories had competitive model support, with known card details and one compatible scoring version. They are not rates for all picks or proof of preference.</Text>
        {ready.map(choice=>{
          const isType=choice.id==='card-type',count=num(choice.selected[isType?'creature':'rare-mythic']||0);
          const expanded=expandedChoices.includes(choice.id);
          return <View key={choice.id} style={styles.contextFact}>
            <Text style={styles.body}>{isType?'Creature choices':'Rare or mythic choices'}: {count} of {num(choice.opportunities)} qualifying picks</Text>
            <Pressable accessibilityRole="button" accessibilityState={{expanded}}
              style={styles.dnaDisclosure} onPress={()=>setExpandedChoices(prev=>prev.includes(choice.id)?
                prev.filter(id=>id!==choice.id):[...prev,choice.id])}>
              <Text style={styles.summary}>Examples and counts</Text>
            </Pressable>
            {expanded?<View style={styles.evidence}>
              <Text style={styles.caption}>{choice.summary}</Text>
              <Text style={styles.caption}>Competitive options: {Object.entries(choice.availability).map(([n,c])=>n+': '+c).join(' · ')}</Text>
              <Text style={styles.caption}>Your picks: {Object.entries(choice.selected).map(([n,c])=>n+': '+c).join(' · ')}</Text>
              {(choice.examples||[]).map(example=><Pressable key={example.puzzle_id}
                accessibilityRole="button" style={styles.exampleLink} onPress={()=>onReview(example)}>
                <Text style={styles.secondaryText}>Review pick · {setName(example.set_id)} P1P{example.pick_number} · {shortDate(example.date)}</Text>
              </Pressable>)}
            </View>:null}
          </View>;
        })}
      </View>:null}
    </View>:null}
    <Pressable accessibilityRole="button" accessibilityState={{expanded:showRules}}
      style={styles.dnaDisclosure} onPress={()=>setShowRules(v=>!v)}>
      <Text style={styles.summary}>How this works</Text>
    </Pressable>
    {showRules?<View style={styles.evidence}>
      <Text style={styles.caption}>{num(dna.eligible_decisions)} picks included independent of the Format and time filters. Only the first included answer per puzzle counts. History is bounded to recent qualifying runs, so older picks may not appear.</Text>
      <Text style={styles.caption}>Traits describe patterns in your picks, not measured skill. {dna.note}</Text>
      {cardChoices?<Text style={styles.caption}>{cardChoices.note}</Text>:null}
    </View>:null}
  </Section>;
}
function CardArtwork({card,label,small=false}: {card:InsightCard|null|undefined;label:string;small?:boolean}) {
  const url=safeCardImageUrl(card?.image_url);
  return <View style={[styles.cardArt,small&&styles.cardArtSmall]}>
    {url?<Image source={{uri:url}}
      accessibilityLabel={label+': '+(card?.name||'Card')}
      resizeMode="contain" style={[styles.cardImage,small&&styles.cardImageSmall]}/>:
      <Text style={styles.caption}>Art unavailable</Text>}
  </View>;
}
function SavedDecisionDetail({detail,onClose}: {detail:InsightDecision;onClose:()=>void}) {
  const pool=detail.prior_picks||[];
  return <View style={styles.decisionDetail}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>Review pick</Text>
    <Text style={styles.meta}>{setName(detail.set_id)} · Source P1P{detail.pick_number} · Score {detail.score}/100 · {shortDate(detail.answered_at)}</Text>
    <Text style={styles.subheading}>Which card fits this pool?</Text>
    <View style={styles.reviewContext}>
      <View style={styles.reviewPart}>
        <Text style={styles.subheading}>Your pick and the trophy pick</Text>
        <View style={styles.decisionChoices}>
          <View style={styles.decisionChoice}><CardArtwork card={detail.selected} label="Your pick"/>
            <Text style={styles.summary}>Your pick</Text><Text style={styles.body}>{detail.selected.name}</Text></View>
          <View style={styles.decisionChoice}><CardArtwork card={detail.trophy} label="Trophy pick"/>
            <Text style={styles.summary}>Trophy pick</Text><Text style={styles.body}>{detail.trophy.name}</Text></View>
        </View>
      </View>
      <View style={styles.reviewPart}>
        <Text style={styles.subheading}>Trophy drafter’s earlier picks</Text>
        {pool.length?<View style={styles.savedPack}>
          {pool.map((card,index)=><View key={card.id+'-'+index} style={styles.savedCard}>
            <CardArtwork card={card} label="Trophy drafter’s earlier pick" small/>
            <Text style={styles.meta}>{card.name}</Text>
          </View>)}
        </View>:<Text style={styles.caption}>Earlier picks aren’t available for this puzzle.</Text>}
      </View>
    </View>
    <Text style={styles.subheading}>Full pack</Text>
    <View style={styles.savedPack}>
      {(detail.candidates||[]).map((card,index)=><View key={card.id+'-'+index} style={styles.savedCard}>
        <CardArtwork card={card} label="Pack card" small/>
        <Text style={styles.meta}>{card.name}{card.id===detail.selected.id?' · Your pick':''}{card.id===detail.trophy.id?' · Trophy pick':''}</Text>
      </View>)}
    </View>
    {detail.ranking?.length?<><Text style={styles.subheading}>Saved alternative scores</Text>
      {detail.ranking.filter(r=>r.score!=null).map(r=><Text key={r.id} style={styles.caption}>
        {r.name}: {r.score}/100{r.support!=null?' · model support '+r.support:''}{r.id===detail.selected.id?' · Your pick':''}
        {r.id===detail.trophy.id?' · Trophy pick':''}
      </Text>)}</>:null}
    {detail.trophy_drafter?.record?<Text style={styles.caption}>The trophy draft finished {detail.trophy_drafter.record}.</Text>:null}
    {detail.trophy_drafter?.win_rate!=null?<Text style={styles.caption}>The trophy drafter’s approximate overall game win rate was {detail.trophy_drafter.win_rate}%, not this card’s win rate.</Text>:null}
    <Text style={styles.caption}>Read-only review. Your pick and score will not change.</Text>
    <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>Close</Text>
    </Pressable>
  </View>;
}
function HighlightsStory({highlights,finding,onReview,onLoadMore,morePhase}:{
  highlights:InsightHighlights;finding?:{id:string;text:string}|null;
  onReview:(item:InsightHighlight)=>void;onLoadMore:()=>void;morePhase:'idle'|'loading'|'error';
}) {
  const [selected,setSelected]=useState<'best'|'misses'>(highlights.misses?.length?'misses':'best');
  const [expanded,setExpanded]=useState(false);
  const rows=selected==='best'?highlights.best:highlights.misses;
  const show=expanded?rows:(rows||[]).slice(0,3);
  return <Section title="Picks to review" caption="Only your first included answer to each puzzle counts."
    onLayout={config.screenshots.fixtures?()=>console.info('PACKONE_INSIGHTS_READY'):undefined}>
    {finding?<Text style={styles.reportLead}>{finding.text} Individual examples illustrate the comparison, not its cause.</Text>:
      <Text style={styles.caption}>Open a pick to see the full pack and the trophy drafter’s earlier picks.</Text>}
    <View style={styles.choices}>
      {(['misses','best'] as const).map(kind=><Pressable key={kind} accessibilityRole="tab"
        accessibilityState={{selected:selected===kind}}
        accessibilityLabel={kind==='misses'?'Picks to revisit':'High-scoring picks'}
        onPress={()=>{setSelected(kind);setExpanded(false);}}
        style={[styles.choice,selected===kind&&styles.choiceActive,styles.reviewTab]}>
        <Text style={[styles.choiceText,selected===kind&&styles.choiceTextActive]}>
          {kind==='misses'?'Picks to revisit':'High-scoring picks'}</Text>
      </Pressable>)}
    </View>
    {show.length?show.map((item,index)=>{
      const own=item.preview?.selected,archived=item.preview?.trophy;
      const ownName=own?.name||item.selected_name||'Card name unavailable';
      const trophyName=archived?.name||item.historical_name||'Card name unavailable';
      return <View key={item.puzzle_id} style={[styles.highlightCard,index>0&&styles.highlightCompact]}>
        <View style={styles.highlightVisual}>
          <View style={styles.highlightArtWrap}><Text style={styles.meta}>Your pick</Text>
            <CardArtwork card={own} label="Your pick" small={index>0}/></View>
          <View style={styles.highlightArtWrap}><Text style={styles.meta}>Trophy pick</Text>
            <CardArtwork card={archived} label="Trophy pick" small={index>0}/></View>
        </View>
        <Text style={styles.body}>Your pick: {ownName}</Text>
        <Text style={styles.body}>Trophy pick: {trophyName}</Text>
        <Text style={styles.meta}>{setName(item.set_id)} · Source P1P{item.pick_number} · {shortDate(item.date)} · Score {item.score}/100</Text>
        {item.finding_context?<Text style={styles.contextNote}>{item.finding_context}</Text>:null}
        <Text style={styles.body}>{reviewExplanation(item)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={'Review pick: '+ownName}
          onPress={()=>onReview(item)} style={styles.compactAction}>
          <Text style={styles.secondaryText}>Review pick</Text>
        </Pressable>
      </View>;
    }):<Text style={styles.caption}>No {selected==='misses'?'picks to revisit':'high-scoring picks'} here. This doesn’t mean you drafted badly.</Text>}
    {!expanded&&((rows||[]).length>3||highlights.has_more?.[selected])?<Pressable accessibilityRole="button"
      style={styles.secondaryButton} onPress={()=>setExpanded(true)}>
      <Text style={styles.secondaryText}>See more picks</Text></Pressable>:null}
    {expanded&&highlights.has_more?.[selected]?<Pressable accessibilityRole="button" disabled={morePhase==='loading'}
      onPress={onLoadMore} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>{morePhase==='loading'?'Loading more picks…':
        morePhase==='error'?'Retry loading picks':'Load more picks'}</Text>
    </Pressable>:null}
    <Text style={styles.caption}>100 means you matched the trophy pick. Other picks earn up to 95 based on the model.</Text>
    <Text style={styles.caption}>Scores describe picks; they don’t prove a choice was objectively right or wrong.</Text>
  </Section>;
}
function JourneyStory({journey,progress,months}:{
  journey:DraftingJourney;progress:DraftInsights['progress'];months:DraftInsights['months'];
}) {
  const [details,setDetails]=useState(false);
  const versionBoundary=journey.progress_compatible===false||
    new Set(journey.windows.map(w=>w.cohort)).size>1;
  return <Section title="Your Drafting Journey" caption="Originally awarded scores · 40-decision windows">
    {versionBoundary?<Text style={styles.journeyWarning} accessibilityRole="alert">
      Historical card-pool or scoring rules changed. These windows are not one continuous progress trend.
    </Text>:null}
    {journey.windows.length?<ScrollView horizontal contentContainerStyle={styles.journeyWindowRow} accessibilityLabel="Your recorded score timeline">
      {journey.windows.map((w,index)=><View key={w.id} style={styles.journeyWindow}
        accessibilityLabel={insightLocalRange(w)+', '+w.count+' decisions'+(w.complete?'':' incomplete')}>
        {index>0&&journey.windows[index-1]?.cohort!==w.cohort?
          <Text style={styles.journeyBoundary}>Version changed</Text>:null}
        <Text style={styles.bigScore}>{score(w.average_score)}</Text>
        <View style={styles.journeyTrack}><View style={[styles.journeyFill,
          {height:(Math.max(0,Math.min(100,w.average_score??0))+'%') as '100%'}]}/></View>
        <Text style={styles.meta}>{shortJourneyRange(w)}</Text>
        <Text style={styles.meta}>{w.count} picks{w.complete?'':' · partial'}</Text>
      </View>)}
    </ScrollView>:<Text style={styles.caption}>Your drafting Journey grows with your original recorded decisions.</Text>}
    {journey.progress_compatible!==false&&progress?<Text style={styles.body}>
      Recent 40: {score(progress.recent.average_score)}/100 · Previous 40: {score(progress.previous.average_score)}/100 ·
      {' '}Difference {progress.delta>0?'+':''}{score(progress.delta)} points (descriptive, not proof of improvement).
    </Text>:null}
    <Pressable accessibilityRole="button" accessibilityState={{expanded:details}}
      style={styles.disclosure} onPress={()=>setDetails(v=>!v)}>
      <Text style={styles.summary}>{details?'Hide journey details':'View journey details'}</Text>
    </Pressable>
    {details?<View style={styles.detailBody}>
      <Text style={styles.caption}>{journey.note} Incomplete windows remain visible as partial.</Text>
      {journey.total_windows>journey.windows.length?<Text style={styles.caption}>Showing the most recent {journey.windows.length} of {journey.total_windows} windows.</Text>:null}
      {journey.windows.map(w=><Text key={w.id} style={styles.caption}>{insightLocalRange(w)} · {w.count} decisions · {score(w.average_score)}/100 · {w.complete?'complete':'incomplete'}</Text>)}
      {journey.progress_compatible===false?<Text style={styles.caption}>Incompatible source/scoring versions prevent the 40/40 comparison.</Text>:null}
      {!progress&&journey.progress_compatible!==false?<Text style={styles.caption}>Two complete and compatible 40-pick groups are needed for the comparison.</Text>:null}
      {journey.milestones.length?<><Text style={styles.subheading}>Milestones</Text>
        {journey.milestones.map(m=><Text key={m.id} style={styles.caption}>{insightLocalRange(m)} · {m.text}{m.average_score!=null?' · '+score(m.average_score)+'/100':''}</Text>)}</>:null}
      <Text style={styles.subheading}>Pacific calendar months</Text>
      {months.length?<View style={styles.months}>{months.map(m=><View key={m.month} style={styles.month}>
        <Text style={styles.meta}>{m.month}</Text><Text style={styles.monthScore}>{score(m.average_score)}</Text>
        <Text style={styles.meta}>{m.count} decisions</Text>
      </View>)}</View>:<Text style={styles.caption}>Monthly averages require at least 10 decisions in a month.</Text>}
    </View>:null}
  </Section>;
}
function LegacyJourney({progress,months}:{
  progress:DraftInsights['progress'];months:DraftInsights['months'];
}) {
  const [allMonths,setAllMonths]=useState(false);
  if(!progress&&!months?.length)return null;
  const visible=allMonths?months:months.slice(-3);
  return <Section title="Your Drafting Journey" caption="Original recorded scores">
    {progress?<Text style={styles.body}>{`Recent 40: ${score(progress.recent.average_score)}/100 · Previous 40: ${score(progress.previous.average_score)}/100 · Difference ${progress.delta>0?'+':''}${score(progress.delta)} points.`}</Text>:null}
    {progress?<Text style={styles.caption}>These are different saved decisions, not proof that your drafting improved or declined.</Text>:null}
    {months.length?<><Text style={styles.subheading}>Pacific calendar months</Text>
      <View style={styles.months}>{visible.map(month=><View key={month.month} style={styles.month}>
        <Text style={styles.meta}>{month.month}</Text>
        <Text style={styles.monthScore}>{score(month.average_score)}</Text>
        <Text style={styles.meta}>{month.count} decisions</Text>
      </View>)}</View>
      {months.length>3?<Pressable accessibilityRole="button"
        accessibilityState={{expanded:allMonths}} style={styles.disclosure}
        onPress={()=>setAllMonths(current=>!current)}>
        <Text style={styles.summary}>{allMonths?'Show recent months':'See all monthly records'}</Text>
      </Pressable>:null}</>:null}
  </Section>;
}
function InsightSections({data,onReview,onLoadMore,morePhase}:{
  data:DraftInsights;onReview:(item:InsightHighlight)=>void;
  onLoadMore:()=>void;morePhase:'idle'|'loading'|'error';
}) {
  const [explore,setExplore]=useState(false);
  if (!data.unlocked) return <Section title="Unlock your Drafting Insights">
    <Text style={styles.body}>Play a few more runs in {data.environment_label}. You have {num(data.eligible_decisions)} of {data.unlock_at} eligible first-time decisions in this period.</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push('/')} style={styles.primaryButton}>
      <Text style={styles.primaryText}>Play today&apos;s Daily</Text>
    </Pressable>
  </Section>;
  const leading=data.leading_finding||data.observations?.[0];
  const extra=(data.observations||[]).slice(leading?1:0);
  return <>
    {data.highlights?<HighlightsStory highlights={data.highlights} finding={leading}
      onReview={onReview} onLoadMore={onLoadMore} morePhase={morePhase}/>:
      leading?<Section title="Your patterns"><Text style={styles.body}>{leading.text}</Text></Section>:null}
    {data.journey?<JourneyStory journey={data.journey} progress={data.progress} months={data.months||[]}/>:
      <LegacyJourney progress={data.progress} months={data.months||[]}/>}
    <Section title="Explore your data">
      <Pressable accessibilityRole="button" accessibilityState={{expanded:explore}}
        style={styles.disclosure} onPress={()=>setExplore(v=>!v)}>
        <Text style={styles.summary}>{explore?'Hide supporting breakdowns':'Explore your data · charts and methodology'}</Text>
      </Pressable>
      {explore?<View style={styles.detailBody}>
        <Text style={styles.subheading}>Pick-by-pick breakdown</Text>
        <Text style={styles.caption}>Actual source P1P positions, with at least five decisions per displayed average.</Text>
        <Metrics rows={(data.pick_depth||[]).map(row=>({...row,label:row.label}))}/>
        <Text style={styles.subheading}>Difficulty breakdown</Text>
        <Metrics rows={(data.difficulty||[]).map(row=>({...row,label:row.band.charAt(0).toUpperCase()+row.band.slice(1)}))}/>
        {data.unknown_difficulty?<Text style={styles.caption}>{num(data.unknown_difficulty)} picks lack a verified difficulty band.</Text>:null}
        <Text style={styles.subheading}>Format breakdown</Text>
        <Text style={styles.caption}>Different card pools; recorded averages do not establish comparable skill.</Text>
        <View style={styles.formats}>{(data.formats||[]).map(row=><View key={row.environment}
          style={[styles.format,row.environment===data.environment&&styles.formatSelected]}>
          <Text style={styles.formatName}>{row.label}</Text>
          <Text style={styles.bigScore}>{score(row.average_score)}</Text>
          <Text style={styles.meta}>{num(row.count)} eligible picks{row.average_score===null?' · need 5':''}</Text>
        </View>)}</View>
        <Text style={styles.subheading}>Additional observations</Text>
        {extra.length?extra.map(row=><Text key={row.id} style={styles.body}>{row.text}</Text>):
          <Text style={styles.caption}>No additional comparison cleared the minimum sample and score-gap rules.</Text>}
        <Text style={styles.subheading}>Methodology</Text>
        <Text style={styles.caption}>{data.methodology}</Text>
      </View>:null}
    </Section>
  </>;
}

export default function InsightsScreen() {
  const [environment, setEnvironment] = useState<InsightsEnvironment>('mixed');
  const [period, setPeriod] = useState<InsightsPeriod>('all');
  const [data, setData] = useState<DraftInsights | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [detail,setDetail]=useState<InsightDecision|null>(null);
  const [detailPhase,setDetailPhase]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [morePhase,setMorePhase]=useState<'idle'|'loading'|'error'>('idle');
  const detailTicket=useRef(0);
  const manualEnvironment=useRef(false);
  const requestId = useRef(0);
  const activeOwner = useRef('');

  const load = useCallback(async () => {
    const id = ++requestId.current;
    detailTicket.current+=1;
    setDetail(null);
    setDetailPhase('idle');
    setMorePhase('idle');
    setData(null);
    setProblem(null);
    setPhase('loading');
    let session: MobileSession | null = null;
    try {
      session = await ensureGuestSession();
      if (id !== requestId.current) return;
      if (!session.accountToken) { activeOwner.current = ''; setPhase('signed-out'); return; }
      const owner = identity(session);
      if (activeOwner.current !== owner) { activeOwner.current = owner; setData(null); }
      const response = await loadMobileInsights(session, environment, period);
      const current = await readSession();
      if (id !== requestId.current) return;
      if (!current?.accountToken || identity(current) !== owner) {
        activeOwner.current = ''; setData(null); setPhase('signed-out'); return;
      }
      if(!manualEnvironment.current&&environment==='mixed'&&response.default_environment&&
        response.default_environment!=='mixed'&&environments.some(v=>v.value===response.default_environment)){
        setEnvironment(response.default_environment);
        return;
      }
      setData(response);
      setPhase('ready');
    } catch (error: unknown) {
      if (id !== requestId.current) return;
      setData(null);
      if (error instanceof ApiError && [401, 403, 410].includes(error.status)) {
        activeOwner.current = ''; setPhase('signed-out');
      } else {
        setProblem(error instanceof Error ? error.message : 'Insights are unavailable.'); setPhase('error');
      }
    }
  }, [environment, period]);

  useEffect(() => subscribeSession(next => {
    const current = next?.accountToken ? identity(next) : '';
    if (current === activeOwner.current) return;
    requestId.current += 1;
    detailTicket.current+=1;
    setDetail(null);
    setDetailPhase('idle');
    setMorePhase('idle');
    activeOwner.current = current;
    manualEnvironment.current=false;
    setData(null);
    setPhase(current ? 'loading' : 'signed-out');
    if (current) void load();
  }), [load]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]));
  useAppResume(() => load());
  const closeDetail=()=>{
    detailTicket.current+=1;
    setDetail(null);
    setDetailPhase('idle');
  };
  const reviewDetail=async(item:InsightDecisionLocator)=>{
    const t=++detailTicket.current,epoch=requestId.current,owner=activeOwner.current;
    setDetail(null);setDetailPhase('loading');
    try{
      const before=await readSession();
      if(!before?.accountToken||identity(before)!==owner)return;
      const response=await loadMobileInsightDecision(before,item);
      const after=await readSession();
      if(t!==detailTicket.current||epoch!==requestId.current||
        !after?.accountToken||identity(after)!==owner)return;
      setDetail(response);setDetailPhase('ready');
    }catch{
      if(t===detailTicket.current&&epoch===requestId.current)
        setDetailPhase('error');
    }
  };

  const loadMore=async()=>{
    const epoch=requestId.current,owner=activeOwner.current;
    if(!data?.highlights?.has_more?.best&&!data?.highlights?.has_more?.misses)return;
    setMorePhase('loading');
    try{
      const before=await readSession();
      if(!before?.accountToken||identity(before)!==owner)return;
      const next=await loadMobileInsights(before,environment,period,2);
      const after=await readSession();
      if(epoch!==requestId.current||!after?.accountToken||identity(after)!==owner)return;
      setData(current=>{
        if(!current?.highlights||!next.highlights)return current;
        const used=new Set<string>();
        const unique=(items:InsightHighlight[])=>items.filter(item=>{
          if(used.has(item.puzzle_id))return false;
          used.add(item.puzzle_id);return true;
        });
        const best=unique([...current.highlights.best,...next.highlights.best]);
        const misses=unique([...current.highlights.misses,...next.highlights.misses]);
        return {...current,highlights:{...current.highlights,best,misses,
          has_more:{best:false,misses:false}}};
      });
      setMorePhase('idle');
    }catch{
      if(epoch===requestId.current)setMorePhase('error');
    }
  };

  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: 'My Pack One' }} />
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>MY PACK ONE</Text>
      <MyPackSectionTabs active="insights" />
      <Text accessibilityRole="header" style={styles.heading}>Your Drafting Insights</Text>
      {phase==='ready'&&data?.drafting_dna?<DNASummary dna={data.drafting_dna}
        cardChoices={data.card_choices} onReview={reviewDetail}/>:null}
      <View style={styles.filters}>
        <ChoiceRow name="Environment" values={environments} selected={environment} onChange={value=>{manualEnvironment.current=true;setEnvironment(value);}} />
        <ChoiceRow name="Time period" values={periods} selected={period} onChange={setPeriod} />
      </View>
      {phase === 'loading' ? <View style={styles.notice}><ActivityIndicator accessibilityLabel="Loading Insights" /><Text style={styles.body}>Loading your private drafting decisions…</Text></View> : null}
      {phase === 'signed-out' ? <Section title="Sign in to see your Insights">
        <Text style={styles.body}>Your private analysis requires a linked Pack One account.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.primaryButton}><Text style={styles.primaryText}>Sign in</Text></Pressable>
      </Section> : null}
      {phase === 'error' ? <Section title="Insights unavailable">
        <Text accessibilityRole="alert" style={styles.body}>{problem || 'Please retry.'} Your other My Pack One sections are still available.</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Retry Insights</Text></Pressable>
      </Section> : null}
      {phase === 'ready' && data ? <>
        <Text style={styles.summary}>{num(data.eligible_decisions)} eligible decisions · {data.environment_label} · {periods.find(p => p.value === period)?.label}</Text>
        <InsightSections data={data} onReview={reviewDetail}
          onLoadMore={()=>void loadMore()} morePhase={morePhase}/>
      </> : null}
      <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refresh Insights</Text></Pressable>
      <AboutLink />
    </ScrollView>
    {detailPhase!=='idle'?<Modal visible animationType="slide" onRequestClose={closeDetail}
      presentationStyle="pageSheet" accessibilityViewIsModal>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.page}>
          {detailPhase==='loading'?<View style={styles.notice}>
            <ActivityIndicator accessibilityLabel="Loading saved decision"/>
            <Text style={styles.body}>Loading your original pack…</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={closeDetail}>
              <Text style={styles.secondaryText}>Cancel review</Text>
            </Pressable>
          </View>:null}
          {detailPhase==='error'?<View style={styles.section}>
            <Text accessibilityRole="alert" style={styles.body}>This original decision could not be loaded.</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={closeDetail}>
              <Text style={styles.secondaryText}>Close original pack</Text>
            </Pressable>
          </View>:null}
          {detailPhase==='ready'&&detail?<SavedDecisionDetail detail={detail} onClose={closeDetail}/>:null}
        </ScrollView>
      </SafeAreaView>
    </Modal>:null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  eyebrow: { color: colors.accent, fontWeight: '800', fontSize: 11, letterSpacing: 1.2 },
  heading: { color: colors.ink, fontSize: 30, lineHeight: 34, fontWeight: '800' },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: -12 },
  filters: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.md },
  choiceGroup: { gap: spacing.xs },
  controlLabel: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', paddingHorizontal: spacing.md },
  choiceActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choiceText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  choiceTextActive: { color: colors.accentDark },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  caption: { fontSize: 13, lineHeight: 19, color: colors.muted },
  body: { fontSize: 14, lineHeight: 21, color: colors.ink },
  summary: { fontSize: 13, fontWeight: '800', color: colors.accentDark },
  notice: { minHeight: 140, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  metricList: { gap: spacing.md },
  metric: { gap: spacing.xs },
  metricHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'baseline' },
  metricName: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.ink },
  metricScore: { fontSize: 12, color: colors.accentDark, fontWeight: '800' },
  track: { width: '100%', height: 11, backgroundColor: colors.surfaceSoft },
  trackFill: { height: '100%', backgroundColor: colors.accent },
  meta: { fontSize: 11, color: colors.muted, lineHeight: 17 },
  observation: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  observationMark: { color: colors.accent, fontSize: 13 },
  observationCopy: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 21 },
  windowRow: { flexDirection: 'row', gap: spacing.sm },
  window: { flex: 1, padding: spacing.md, backgroundColor: colors.surfaceSoft, gap: spacing.xs },
  bigScore: { fontSize: 30, fontWeight: '800', color: colors.ink },
  subheading: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: spacing.sm },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  month: { minWidth: 105, flexGrow: 1, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.surfaceSoft },
  monthScore: { fontSize: 22, fontWeight: '800', color: colors.ink },
  formats: { gap: spacing.sm },
  format: { padding: spacing.md, borderWidth: 1, borderColor: colors.line, gap: spacing.xs },
  formatSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  formatName: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  dnaTrait: {gap:spacing.xs,padding:spacing.sm},
  dnaSection: {padding:spacing.md,gap:spacing.sm},
  dnaPrimary: {borderLeftWidth:3,borderLeftColor:colors.accent,backgroundColor:colors.surfaceSoft,
    paddingHorizontal:spacing.md,paddingVertical:spacing.sm},
  dnaTitle: {fontSize:23,fontWeight:'800',color:colors.ink},
  dnaSecondary: {flexDirection:'row',gap:spacing.sm},
  dnaHalf: {flex:1,minWidth:0,borderBottomWidth:1,borderColor:colors.line},
  dnaCompact: {paddingHorizontal:0,paddingVertical:0},
  dnaDeveloping: {fontSize:12,color:colors.muted,paddingVertical:spacing.sm,lineHeight:17},
  dnaDisclosure: {minHeight:36,justifyContent:'center',paddingVertical:spacing.xs},
  evidence: {paddingTop:spacing.xs,gap:spacing.xs},
  contextTitle: {fontSize:12,fontWeight:'700',color:colors.muted},
  contextLine: {flexDirection:'row',alignItems:'baseline',gap:spacing.sm,justifyContent:'space-between'},
  contextCount: {fontSize:13,fontWeight:'800',color:colors.accentDark,textAlign:'right'},
  contextNote: {fontSize:12,fontWeight:'700',color:colors.accentDark},
  journeyWarning: {fontSize:13,lineHeight:19,color:colors.ink,borderLeftWidth:3,
    borderLeftColor:colors.line,paddingLeft:spacing.sm},
  journeyBoundary: {fontSize:10,fontWeight:'800',color:colors.accentDark,textAlign:'center'},
  highlightCard: {borderWidth:1,borderColor:colors.line,padding:spacing.md,gap:spacing.sm},
  highlightVisual: {flexDirection:'row',gap:spacing.sm},
  cardArt: {minHeight:100,flex:1,justifyContent:'center',alignItems:'center',backgroundColor:colors.surfaceSoft},
  cardImage: {width:'100%',height:165},
  decisionDetail: {borderWidth:2,borderColor:colors.accent,padding:spacing.md,gap:spacing.md},
  decisionChoices: {flexDirection:'row',gap:spacing.sm},
  decisionChoice: {flex:1,minWidth:0,gap:spacing.xs},
  savedPack: {flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},
  savedCard: {width:'46%',minWidth:0,gap:spacing.xs},
  journeyWindowRow: {gap:spacing.sm,paddingVertical:spacing.md},
  journeyWindow: {width:95,alignItems:'center',gap:spacing.xs},
  journeyTrack: {height:110,width:'100%',backgroundColor:colors.surfaceSoft,justifyContent:'flex-end'},
  journeyFill: {backgroundColor:colors.accent,width:'100%'},
  primaryButton: { minHeight: 48, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md },
  primaryText: { color: colors.surface, fontSize: 14, fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md },
  secondaryText: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  disclosure: {borderTopWidth:1,borderColor:colors.line,paddingVertical:spacing.sm,minHeight:44,justifyContent:'center'},
  contextWrap: {gap:spacing.xs,borderTopWidth:1,borderColor:colors.line,paddingTop:spacing.sm},
  contextFact: {gap:spacing.xs,paddingVertical:spacing.xs,borderBottomWidth:1,borderColor:colors.line},
  exampleLink: {borderWidth:1,borderColor:colors.accent,padding:spacing.sm,minHeight:44,justifyContent:'center'},
  reportLead: {color:colors.ink,fontSize:14,lineHeight:21},
  highlightCompact: {padding:spacing.sm,gap:spacing.xs},
  highlightArtWrap: {flex:1,minWidth:0,gap:spacing.xs},
  compactAction: {minHeight:44,alignItems:'flex-start',justifyContent:'center',paddingHorizontal:spacing.sm,borderWidth:1,borderColor:colors.accent},
  detailBody: {gap:spacing.md},

});
