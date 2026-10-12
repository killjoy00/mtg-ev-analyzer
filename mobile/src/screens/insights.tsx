import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {safeCardImageUrl} from '../../../card-image-policy.mjs';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { AboutLink } from '@/src/components/AboutLink';
import { loadMobileInsights, loadMobileInsightDecision, type DraftInsights, type DraftingDNA, type DnaTrait, type CardChoices, type DraftingJourney, type InsightHighlights, type InsightHighlight, type InsightDecision, type InsightCard, type InsightGroup, type InsightsEnvironment, type InsightsPeriod } from '@/src/api/insights';
import { ApiError } from '@/src/api/client';
import { ensureGuestSession } from '@/src/api/guest';
import { useAppResume } from '@/src/hooks/useAppResume';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

const environments: { value: InsightsEnvironment; label: string }[] = [
  { value: 'mixed', label: 'Mixed' }, { value: 'latest', label: 'Latest Set' }, { value: 'powered-cube', label: 'Powered Cube' },
];
const periods: { value: InsightsPeriod; label: string }[] = [
  { value: 'all', label: 'All available' }, { value: '90d', label: 'Last 90 days' }, { value: '365d', label: 'Last year' },
];
const identity = (session: MobileSession | null) => session
  ? JSON.stringify([session.playerToken, session.accountToken ?? '', session.subjectId ?? '', session.accountUser?.id ?? '']) : '';
const score = (value: number | null) => value === null ? '—' : Number(value).toFixed(1);
const num = (value: number) => Number(value || 0).toLocaleString();
const shortDate = (value?:string) => {
  if (!value || !/^\\d{4}-\\d{2}-\\d{2}/.test(value)) return value||'';
  const n=Number(value.slice(5,7)),date=Number(value.slice(8,10));
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][n-1]+' '+date;
};

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

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return <View style={styles.section}>
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

// Only the server's >=40-per-side / >=10-point findings are standout claims.
// When none exist, expose factual score snapshots rather than implying an account
// with substantial history has no usable decisions.
function descriptivePatternRows(data: DraftInsights): string[] {
  const rows: string[] = [];
  const summary = data.formats.find(row => row.environment === data.environment);
  if (summary && summary.count >= 5 && typeof summary.average_score === 'number' && Number.isFinite(summary.average_score)) {
    const match = typeof summary.trophy_match_pct === 'number' && Number.isFinite(summary.trophy_match_pct)
      ? ' Trophy-drafter pick match: ' + score(summary.trophy_match_pct) + '%.' : '';
    rows.push('Across ' + num(summary.count) + ' eligible ' + data.environment_label +
      ' decisions, your average originally awarded score was ' + score(summary.average_score) + '/100.' + match);
  }
  const progress = data.progress;
  if (progress && progress.recent.count >= 40 && progress.previous.count >= 40 &&
    typeof progress.recent.average_score === 'number' && Number.isFinite(progress.recent.average_score) &&
    typeof progress.previous.average_score === 'number' && Number.isFinite(progress.previous.average_score)) {
    rows.push('Your most recent 40 picks averaged ' + score(progress.recent.average_score) +
      '/100; the preceding 40 averaged ' + score(progress.previous.average_score) +
      '/100. These are recorded scores, not a proven change in skill.');
  }
  const depth = [...data.pick_depth]
    .filter(row => row.count >= 5 && typeof row.average_score === 'number' && Number.isFinite(row.average_score))
    .sort((a, b) => b.count - a.count || a.pick_number - b.pick_number)[0];
  if (depth) rows.push('Your most-recorded source pick position is ' + depth.label +
    ': ' + num(depth.count) + ' decisions averaging ' + score(depth.average_score) + '/100.');
  return rows.slice(0, 3);
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

function DNATrait({trait,primary=false}: {trait:DnaTrait|null;primary?:boolean}) {
  const [expanded,setExpanded]=useState(false);
  if (!trait || trait.status!=='qualified') {
    return <View style={[styles.dnaTrait,primary&&styles.dnaPrimary,styles.dnaCompact]}>
      <Text style={primary?styles.dnaTitle:styles.summary}>{primary?'Your Drafting DNA is taking shape':'Developing'}</Text>
      {primary?<Text style={styles.caption}>No provisional identity currently meets its full evidence and stability rules.</Text>:null}
    </View>;
  }
  return <View style={[styles.dnaTrait,primary&&styles.dnaPrimary,!primary&&styles.dnaCompact]}>
    <Text style={[styles.dnaTitle,primary&&styles.dnaPrimaryTitle]}>{trait.title}</Text>
    {primary?<Text style={styles.body}>{trait.summary}</Text>:null}
    <Pressable accessibilityRole="button" accessibilityState={{expanded}}
      style={styles.disclosure} onPress={()=>setExpanded(current=>!current)}>
      <Text style={styles.summary}>{expanded?'Hide evidence':'Why this fits'}</Text>
    </Pressable>
    {expanded?<View style={styles.evidence}>
      {!primary?<Text style={styles.caption}>{trait.summary}</Text>:null}
      <Text style={styles.meta}>{trait.supporting_decisions} eligible supporting decisions</Text>
      {trait.evidence.map((entry,index)=><Text key={entry.label+index} style={styles.caption}>
        {entry.label}: {String(entry.value)}
      </Text>)}
    </View>:null}
  </View>;
}
function DNASummary({dna,cardChoices,onReview}:{
  dna:DraftingDNA;cardChoices?:CardChoices;onReview:(item:InsightHighlight)=>void;
}) {
  const [showRules,setShowRules]=useState(false);
  const [expandedChoices,setExpandedChoices]=useState<string[]>([]);
  const ready=(cardChoices?.choices||[]).filter(choice=>choice.status==='ready');
  return <Section title="Your Drafting DNA" caption={'All available history · '+num(dna.eligible_decisions)+' eligible decisions'}>
    <DNATrait trait={dna.primary||dna.primary_emerging||null} primary/>
    <View style={styles.dnaSecondary}>
      {(dna.secondary||[{status:'emerging',label:'Developing'},{status:'emerging',label:'Developing'}] as DnaTrait[]).slice(0,2).map((trait,index)=>
        <View key={'trait-'+index} style={styles.dnaHalf}><DNATrait trait={trait}/></View>)}
    </View>
    <Text style={styles.caption}>Reaching the sample floor does not guarantee a trait.</Text>
    {ready.length?<View style={styles.contextWrap}>
      <Text style={styles.subheading}>Your card choices</Text>
      {ready.map(choice=><View key={choice.id} style={styles.contextFact}>
        <Text style={styles.summary}>{choice.title}</Text>
        <Text style={styles.body}>{choice.summary}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{expanded:expandedChoices.includes(choice.id)}}
          style={styles.disclosure} onPress={()=>setExpandedChoices(prev=>prev.includes(choice.id)?
            prev.filter(id=>id!==choice.id):[...prev,choice.id])}>
          <Text style={styles.summary}>Options and examples · {choice.opportunities} decisions</Text>
        </Pressable>
        {expandedChoices.includes(choice.id)?<View style={styles.evidence}>
          <Text style={styles.caption}>Available competitive options: {Object.entries(choice.availability).map(([name,count])=>name+': '+count).join(' · ')}</Text>
          <Text style={styles.caption}>Your selections: {Object.entries(choice.selected).map(([name,count])=>name+': '+count).join(' · ')}</Text>
          {(choice.examples||[]).map(example=><Pressable key={example.puzzle_id}
            accessibilityRole="button" style={styles.exampleLink} onPress={()=>onReview({
              ...example,score:0,trophy_match:false,environment:'mixed',selection_kind:'alternative',
            } as InsightHighlight)}>
            <Text style={styles.secondaryText}>Review {example.selected_name||'saved pick'} · {example.set_id} P1P{example.pick_number} · {shortDate(example.date)}</Text>
          </Pressable>)}
        </View>:null}
      </View>)}
    </View>:<Text style={styles.caption}>Card-choice context is developing. At least {cardChoices?.minimum_opportunities??20} qualifying opportunities in one model-version cohort are needed to display a breakdown.</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{expanded:showRules}}
      style={styles.disclosure} onPress={()=>setShowRules(value=>!value)}>
      <Text style={styles.summary}>Scope and evidence rules</Text>
    </Pressable>
    {showRules?<View style={styles.evidence}><Text style={styles.caption}>{dna.note}</Text>
      <Text style={styles.caption}>{cardChoices?.note||'Historical saved card-choice context may be unavailable.'}</Text>
    </View>:null}
  </Section>;
}
function CardArtwork({card,label}: {card:InsightCard|null|undefined;label:string}) {
  const url=safeCardImageUrl(card?.image_url);
  return <View style={styles.cardArt}>
    {url?<Image source={{uri:url}}
      accessibilityLabel={label+': '+card?.name}
      resizeMode="contain" style={styles.cardImage}/>:
      <Text style={styles.caption}>{card?.name||'Card image unavailable'}</Text>}
  </View>;
}
function SavedDecisionDetail({detail,onClose}: {detail:InsightDecision;onClose:()=>void}) {
  return <View style={styles.decisionDetail}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>Original saved pack</Text>
    <Text style={styles.meta}>{detail.set_id} · P1P{detail.pick_number} · {score(detail.score)}/100 · {detail.answered_at.slice(0,10)}</Text>
    <View style={styles.decisionChoices}>
      <View style={styles.decisionChoice}><CardArtwork card={detail.selected} label="Your pick"/><Text style={styles.summary}>Your pick: {detail.selected.name}</Text></View>
      {detail.trophy.id!==detail.selected.id?<View style={styles.decisionChoice}><CardArtwork card={detail.trophy} label="Trophy pick"/><Text style={styles.summary}>Trophy pick: {detail.trophy.name}</Text></View>:null}
    </View>
    <Text style={styles.subheading}>All original cards</Text>
    <View style={styles.savedPack}>
      {detail.candidates.map(card=><View key={card.id} style={styles.savedCard}>
        <CardArtwork card={card} label="Saved pack card"/>
        <Text style={styles.meta}>{card.name}{card.id===detail.selected.id?' · Your pick':''}{card.id===detail.trophy.id?' · Trophy pick':''}</Text>
      </View>)}
    </View>
    {detail.prior_picks.length?<><Text style={styles.subheading}>Original drafter’s prior picks</Text>
      <Text style={styles.caption}>{detail.prior_picks.map(c=>c.name).join(' · ')}</Text></>:null}
    {detail.trophy_drafter?.record?<Text style={styles.caption}>This verified trophy draft finished {detail.trophy_drafter.record}.</Text>:null}
    {detail.trophy_drafter?.win_rate!=null?<Text style={styles.caption}>The original drafter’s approximate overall game win rate was {detail.trophy_drafter.win_rate}%, not this card’s win rate.</Text>:null}
    {detail.ranking?.length?<><Text style={styles.subheading}>Why this score? Saved alternatives</Text>
      {detail.ranking.filter(r=>r.score!=null).map(r=><Text key={r.id} style={styles.caption}>
        {r.name}: {r.score}/100{r.support!=null?' · saved support '+r.support:''}{r.id===detail.selected.id?' · Your pick':''}
        {r.id===detail.trophy.id?' · Trophy pick':''}
      </Text>)}</>:null}
    <Text style={styles.caption}>Read-only historical results. Your original score and pick are unchanged.</Text>
    <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>Close original pack</Text>
    </Pressable>
  </View>;
}
function HighlightsStory({highlights,finding,onReview,onLoadMore,morePhase}:{
  highlights:InsightHighlights;finding?:{id:string;text:string}|null;
  onReview:(item:InsightHighlight)=>void;onLoadMore:()=>void;morePhase:'idle'|'loading'|'error';
}) {
  const [selected,setSelected]=useState<'best'|'misses'>('best');
  const [expanded,setExpanded]=useState(false);
  const rows=selected==='best'?highlights.best:highlights.misses;
  const show=expanded?rows:rows.slice(0,3);
  return <Section title="Decision report" caption={num(rows.length)+' saved highlights available in '+(selected==='best'?'Best Calls':'Biggest Misses')}>
    <Text style={styles.reportLead}>
      <Text style={styles.summary}>{finding?'Leading finding: ':'Your recent decisions: '}</Text>
      {finding?.text||'No standout comparison has qualified in this environment and time period. These saved picks are factual examples.'}
    </Text>
    <View style={styles.choices}>
      {(['best','misses'] as const).map(kind=><Pressable key={kind} accessibilityRole="button"
        accessibilityState={{selected:selected===kind}}
        onPress={()=>{setSelected(kind);setExpanded(false);}}
        style={[styles.choice,selected===kind&&styles.choiceActive]}>
        <Text style={[styles.choiceText,selected===kind&&styles.choiceTextActive]}>{kind==='best'?'Best Calls':'Biggest Misses'}</Text>
      </Pressable>)}
    </View>
    {show.length?show.map((item,index)=><View key={item.puzzle_id} style={[styles.highlightCard,index>0&&styles.highlightCompact]}>
      {index===0?<View style={styles.highlightVisual}>
        <View style={styles.highlightArtWrap}><Text style={styles.meta}>Your pick</Text><CardArtwork card={item.preview?.selected} label="Your pick"/></View>
        {!item.trophy_match?<View style={styles.highlightArtWrap}><Text style={styles.meta}>Trophy pick</Text><CardArtwork card={item.preview?.trophy} label="Trophy pick"/></View>:null}
      </View>:null}
      <Text style={styles.summary}>Your pick: {item.preview?.selected?.name||item.selected_name||'Saved selection'}</Text>
      <Text style={styles.meta}>{item.trophy_match?'Trophy pick matched':'Trophy pick: '+(item.preview?.trophy?.name||item.historical_name||'Original trophy selection')}</Text>
      <Text style={styles.meta}>{item.set_id} · P1P{item.pick_number} · {shortDate(item.date)} · Original score {item.score}/100</Text>
      <Text style={styles.body}>{item.reason_text||(
        item.trophy_match?'You matched the original trophy selection.':
          'Your original non-trophy decision earned '+item.score+'/100.')}</Text>
      <Pressable accessibilityRole="button" onPress={()=>onReview(item)} style={styles.compactAction}>
        <Text style={styles.secondaryText}>Review original pack</Text>
      </Pressable>
    </View>):<Text style={styles.caption}>No qualifying saved picks in this group for these filters.</Text>}
    {rows.length>3&&!expanded?<Pressable accessibilityRole="button" style={styles.secondaryButton}
      onPress={()=>setExpanded(true)}><Text style={styles.secondaryText}>See more</Text></Pressable>:null}
    {expanded&&highlights.has_more?.[selected]?<Pressable accessibilityRole="button" disabled={morePhase==='loading'}
      onPress={onLoadMore} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>{morePhase==='loading'?'Loading saved picks…':
        morePhase==='error'?'Retry loading more picks':'See more saved decisions'}</Text>
    </Pressable>:null}
    <Text style={styles.caption}>These are historical scored calls, not proof of objectively right or wrong Magic choices.</Text>
  </Section>;
}
function JourneyStory({journey,progress,months}:{
  journey:DraftingJourney;progress:DraftInsights['progress'];months:DraftInsights['months'];
}) {
  const [details,setDetails]=useState(false);
  return <Section title="Your Drafting Journey" caption="Originally awarded scores · 40-decision windows">
    {journey.windows.length?<ScrollView horizontal contentContainerStyle={styles.journeyWindowRow} accessibilityLabel="Your recorded score timeline">
      {journey.windows.map(w=><View key={w.id} style={styles.journeyWindow}
        accessibilityLabel={insightLocalRange(w)+', '+w.count+' decisions'+(w.complete?'':' incomplete')}>
        <Text style={styles.bigScore}>{score(w.average_score)}</Text>
        <View style={styles.journeyTrack}><View style={[styles.journeyFill,
          {height:(Math.max(0,Math.min(100,w.average_score??0))+'%') as '100%'}]}/></View>
        <Text style={styles.meta}>{shortDate(w.from)+'–'+shortDate(w.to)}</Text>
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
function InsightSections({ data,onReview,detail,detailPhase,onClose,onLoadMore,morePhase }: {
  data:DraftInsights;onReview:(item:InsightHighlight)=>void;detail:InsightDecision|null;
  detailPhase:'idle'|'loading'|'ready'|'error';onClose:()=>void;
  onLoadMore:()=>void;morePhase:'idle'|'loading'|'error';
}) {
  if (!data.unlocked) return <>
    {data.drafting_dna?<DNASummary dna={data.drafting_dna}/>:null}
    <Section title="Unlock your Drafting Insights">
    <Text style={styles.body}>Play a few more runs in {data.environment_label}. You have {num(data.eligible_decisions)} of {data.unlock_at} eligible first-time decisions in this period.</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push('/')} style={styles.primaryButton}>
      <Text style={styles.primaryText}>Play today&apos;s Daily</Text>
    </Pressable>
  </Section></>;

  const monthly = data.months || [];
  const snapshots = data.observations.length ? [] : descriptivePatternRows(data);
  return <>
    {data.drafting_dna?<DNASummary dna={data.drafting_dna}/>:null}
    {data.highlights?<HighlightsStory highlights={data.highlights} onReview={onReview}
      detail={detail} detailPhase={detailPhase} onClose={onClose}
      onLoadMore={onLoadMore} morePhase={morePhase}/>:null}
    {data.journey?<JourneyStory journey={data.journey} progress={data.progress} months={monthly}/>:null}
    <Section title="Your patterns" caption="Observed scores with clear sample-size safeguards">
      {data.observations.length ? data.observations.map(row =>
        <View key={row.id} style={styles.observation}><Text style={styles.observationMark}>◆</Text><Text style={styles.observationCopy}>{row.text}</Text></View>)
        : <>
          <Text style={styles.caption}>No standout comparison met both thresholds: at least 40 decisions on each side and a 10-point average difference. Your recorded history still provides these descriptive snapshots:</Text>
          {snapshots.length ? snapshots.map((text, index) =>
            <View key={'snapshot-' + index} style={styles.observation}><Text style={styles.observationMark}>◆</Text><Text style={styles.observationCopy}>{text}</Text></View>)
            : <Text style={styles.caption}>The pick, difficulty and progress charts below show every supported group as you collect more decisions.</Text>}
        </>}
    </Section>
    <Section title="Pick-by-pick strengths" caption="Actual source P1P positions, not game-round order. Five decisions are needed for each average.">
      <Metrics rows={data.pick_depth.map(row => ({ ...row, label: row.label }))} />
    </Section>
    <Section title="Difficulty context" caption="These bands contain different puzzles; no difficulty-adjusted skill grade is inferred.">
      <Metrics rows={data.difficulty.map(row => ({ ...row, label: row.band.charAt(0).toUpperCase() + row.band.slice(1) }))} />
      {data.unknown_difficulty ? <Text style={styles.meta}>{num(data.unknown_difficulty)} decisions lack a verified difficulty band.</Text> : null}
    </Section>
    {!data.journey?<Section title="Progress over time" caption="Two consecutive 40-pick windows in the selected environment">
      {data.progress ? <>
        <View style={styles.windowRow}>
          <View style={styles.window}><Text style={styles.meta}>Previous 40 picks</Text><Text style={styles.bigScore}>{score(data.progress.previous.average_score)}</Text>
            <Text style={styles.meta}>{data.progress.previous.from} to {data.progress.previous.to}</Text></View>
          <View style={styles.window}><Text style={styles.meta}>Latest 40 picks</Text><Text style={styles.bigScore}>{score(data.progress.recent.average_score)}</Text>
            <Text style={styles.meta}>{data.progress.recent.from} to {data.progress.recent.to}</Text></View>
        </View>
        <Text style={styles.caption}>Recorded difference: {data.progress.delta > 0 ? '+' : ''}{score(data.progress.delta)} points. Different picks cannot prove improvement or decline.</Text>
      </> : <Text style={styles.caption}>This comparison needs 80 eligible decisions (40 in each window). You have {num(data.eligible_decisions)}.</Text>}
      <Text style={styles.subheading}>Pacific calendar months</Text>
      {monthly.length ? <View style={styles.months}>{monthly.map(row => <View key={row.month} style={styles.month}>
        <Text style={styles.meta}>{row.month}</Text><Text style={styles.monthScore}>{score(row.average_score)}</Text>
        <Text style={styles.meta}>{num(row.count)} picks{row.average_score === null ? ' · need 10' : ''}</Text>
      </View>)}</View> : <Text style={styles.caption}>Monthly averages need at least 10 eligible decisions per Pacific month.</Text>}
    </Section>:null}
    <Section title="Format patterns" caption="Card pools differ between formats; these are recorded scores, not skill rankings.">
      <View style={styles.formats}>{data.formats.map(row => <View key={row.environment}
        style={[styles.format, row.environment === data.environment && styles.formatSelected]}>
        <Text style={styles.formatName}>{row.label}</Text><Text style={styles.bigScore}>{score(row.average_score)}</Text>
        <Text style={styles.meta}>{num(row.count)} eligible picks{row.average_score === null ? ' · need 5' : ''}</Text>
      </View>)}</View>
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
  const reviewDetail=async(item:InsightHighlight)=>{
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
      <View accessibilityLabel="My Pack One sections" style={styles.tabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }}
          onPress={() => router.dismissTo('/career')} style={styles.tab}><Text style={styles.tabText}>Stats</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: true }}
          style={[styles.tab, styles.tabSelected]}><Text style={[styles.tabText, styles.tabTextSelected]}>Insights</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }}
          onPress={() => router.push('/account')} style={styles.tab}><Text style={styles.tabText}>Account settings</Text></Pressable>
      </View>
      <Text accessibilityRole="header" style={styles.heading}>Your Drafting Insights</Text>
      <Text style={styles.intro}>Explore how your real draft decisions vary by pick, format and difficulty.</Text>
      <View style={styles.filters}>
        <ChoiceRow name="Environment" values={environments} selected={environment} onChange={setEnvironment} />
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
        <InsightSections data={data} detail={detail} detailPhase={detailPhase}
          onReview={reviewDetail} onClose={closeDetail}
          onLoadMore={()=>void loadMore()} morePhase={morePhase}/>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How these insights are calculated</Text>
          <Text style={styles.caption}>{data.methodology}</Text>
        </View>
      </> : null}
      <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refresh Insights</Text></Pressable>
      <AboutLink />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  eyebrow: { color: colors.accent, fontWeight: '800', fontSize: 11, letterSpacing: 1.2 },
  heading: { color: colors.ink, fontSize: 30, lineHeight: 34, fontWeight: '800' },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: -12 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  tab: { minWidth: 0, flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  tabSelected: { borderBottomWidth: 3, borderColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  tabTextSelected: { color: colors.ink },
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
  dnaTrait: {borderWidth:1,borderColor:colors.line,padding:spacing.md,gap:spacing.sm,backgroundColor:colors.surfaceSoft},
  dnaPrimary: {borderLeftWidth:4,borderLeftColor:colors.accent},
  dnaTitle: {fontSize:20,fontWeight:'800',color:colors.ink},
  dnaPrimaryTitle: {fontSize:27},
  dnaSecondary: {flexDirection:'row',gap:spacing.sm},
  dnaHalf: {flex:1,minWidth:0},
  evidence: {paddingTop:spacing.sm,gap:spacing.xs},
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
});
