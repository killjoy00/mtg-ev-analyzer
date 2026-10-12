import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { AboutLink } from '@/src/components/AboutLink';
import { loadMobileInsights, loadMobileInsightDecision, type DraftInsights, type DraftingDNA, type DnaTrait, type DraftingJourney, type InsightHighlights, type InsightHighlight, type InsightDecision, type InsightCard, type InsightGroup, type InsightsEnvironment, type InsightsPeriod } from '@/src/api/insights';
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

function DNATrait({trait,primary=false}: {trait:DnaTrait|null;primary?:boolean}) {
  if(!trait||trait.status!=='qualified')return <View style={[styles.dnaTrait,primary&&styles.dnaPrimary]}>
    <Text style={styles.dnaTitle}>{primary?'Your drafting DNA is taking shape':'Trait still developing'}</Text>
    <Text style={styles.caption}>More comparable first-time decisions are needed to support a classification.</Text>
  </View>;
  return <View style={[styles.dnaTrait,primary&&styles.dnaPrimary]}>
    <Text style={[styles.dnaTitle,primary&&styles.dnaPrimaryTitle]}>{trait.title}</Text>
    <Text style={styles.body}>{trait.summary}</Text>
    <Text style={styles.meta}>{trait.supporting_decisions} eligible supporting decisions</Text>
    <View style={styles.evidence}>
      <Text style={styles.summary}>Why this fits</Text>
      {trait.evidence.map((entry,index)=><Text key={entry.label+index} style={styles.caption}>
        {entry.label}: {String(entry.value)}
      </Text>)}
    </View>
  </View>;
}
function DNASummary({dna}:{dna:DraftingDNA}) {
  return <Section title="Your Drafting DNA" caption="All eligible first-time decisions, independent of the filters below">
    <DNATrait trait={dna.primary} primary />
    <View style={styles.dnaSecondary}>
      {(dna.secondary||[]).slice(0,2).map((trait,index)=>
        <View key={'trait-'+index} style={styles.dnaHalf}><DNATrait trait={trait}/></View>)}
    </View>
    <Text style={styles.caption}>{dna.note}</Text>
  </Section>;
}
function CardArtwork({card,label}: {card:InsightCard|null|undefined;label:string}) {
  const url=card?.image_url;
  return <View style={styles.cardArt}>
    {url&&/^https:\/\//.test(url)?<Image source={{uri:url}}
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
    {detail.prior_picks.length?<><Text style={styles.subheading}>Previously selected cards</Text>
      <Text style={styles.caption}>{detail.prior_picks.map(c=>c.name).join(' · ')}</Text></>:null}
    {detail.trophy_drafter?.record?<Text style={styles.caption}>This verified trophy draft finished {detail.trophy_drafter.record}.</Text>:null}
    {detail.trophy_drafter?.win_rate!=null?<Text style={styles.caption}>The original drafter’s approximate overall game win rate was {detail.trophy_drafter.win_rate}%, not this card’s win rate.</Text>:null}
    <Text style={styles.caption}>Read-only historical results. Your original score and pick are unchanged.</Text>
    <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>Close original pack</Text>
    </Pressable>
  </View>;
}
function HighlightsStory({highlights,onReview,detail,detailPhase,onClose}:{
  highlights:InsightHighlights;onReview:(item:InsightHighlight)=>void;detail:InsightDecision|null;
  detailPhase:'idle'|'loading'|'ready'|'error';onClose:()=>void;
}) {
  const [selected,setSelected]=useState<'best'|'misses'>('best');
  const rows=selected==='best'?highlights.best:highlights.misses;
  return <Section title="Your Best Calls & Biggest Misses" caption="Real saved cards and original awarded scores, not proof that any alternative was objectively wrong">
    <View style={styles.choices}>
      <Pressable accessibilityRole="button" accessibilityState={{selected:selected==='best'}}
        onPress={()=>{setSelected('best');onClose();}} style={[styles.choice,selected==='best'&&styles.choiceActive]}>
        <Text style={styles.choiceText}>Best Calls</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{selected:selected==='misses'}}
        onPress={()=>{setSelected('misses');onClose();}} style={[styles.choice,selected==='misses'&&styles.choiceActive]}>
        <Text style={styles.choiceText}>Biggest Misses</Text>
      </Pressable>
    </View>
    {rows.length?rows.map(item=><View key={item.puzzle_id} style={styles.highlightCard}>
      <View style={styles.highlightVisual}>
        <CardArtwork card={item.preview?.selected} label="Your original choice"/>
        {item.preview?.trophy?.id!==item.preview?.selected?.id&&item.preview?.trophy?
          <CardArtwork card={item.preview.trophy} label="Original trophy choice"/>:null}
      </View>
      <Text style={styles.summary}>{item.preview?.selected?.name||'Your saved pick'} · {item.score}/100</Text>
      <Text style={styles.meta}>{item.set_id} · P1P{item.pick_number} · {item.date} · {item.trophy_match?'Matched trophy':'Alternative selection'}</Text>
      <Pressable accessibilityRole="button" onPress={()=>onReview(item)} style={styles.secondaryButton}>
        <Text style={styles.secondaryText}>Review original pack</Text>
      </Pressable>
    </View>):<Text style={styles.caption}>No qualifying saved picks in this group yet.</Text>}
    {detailPhase==='loading'?<Text style={styles.caption}>Loading your saved decision…</Text>:null}
    {detailPhase==='error'?<Text accessibilityRole="alert" style={styles.caption}>This original decision could not be loaded. Try again.</Text>:null}
    {detailPhase==='ready'&&detail?<SavedDecisionDetail detail={detail} onClose={onClose}/>:null}
  </Section>;
}
function JourneyStory({journey,progress,months}:{
  journey:DraftingJourney;progress:DraftInsights['progress'];months:DraftInsights['months'];
}) {
  return <Section title="Your Drafting Journey" caption="Original scores in 40-decision chronological windows">
    {journey.windows.length?<ScrollView horizontal contentContainerStyle={styles.journeyWindowRow} accessibilityLabel="Your recorded score timeline">
      {journey.windows.map(w=><View key={w.id} style={styles.journeyWindow}
        accessibilityLabel={w.from+' to '+w.to+', '+w.count+' decisions'+(w.complete?'':' incomplete')}>
        <Text style={styles.bigScore}>{score(w.average_score)}</Text>
        <View style={styles.journeyTrack}><View style={[styles.journeyFill,
          {height:(Math.max(0,Math.min(100,w.average_score??0))+'%') as '100%'}]}/></View>
        <Text style={styles.meta}>{w.to}</Text>
        <Text style={styles.meta}>{w.count} picks{w.complete?'':' · incomplete'}</Text>
      </View>)}
    </ScrollView>:<Text style={styles.caption}>Your drafting journey grows with your original recorded decisions.</Text>}
    <Text style={styles.caption}>{journey.note}</Text>
    <Text style={styles.subheading}>Most recent vs previous 40</Text>
    {progress?<View style={styles.windowRow}>
      <View style={styles.window}><Text style={styles.meta}>Previous 40</Text><Text style={styles.bigScore}>{score(progress.previous.average_score)}</Text></View>
      <View style={styles.window}><Text style={styles.meta}>Recent 40</Text><Text style={styles.bigScore}>{score(progress.recent.average_score)}</Text></View>
    </View>:<Text style={styles.caption}>Two completed 40-pick windows are needed for a recent-vs-previous score comparison.</Text>}
    {journey.milestones.length?<><Text style={styles.subheading}>Your milestones</Text>
      {journey.milestones.map(m=><Text key={m.id} style={styles.body}>{m.date} · {m.text}{m.average_score!=null?' · '+score(m.average_score)+'/100':''}</Text>)}</>:null}
    <Text style={styles.subheading}>Pacific calendar months</Text>
    <View style={styles.months}>{months.map(m=><View key={m.month} style={styles.month}>
      <Text style={styles.meta}>{m.month}</Text><Text style={styles.monthScore}>{score(m.average_score)}</Text>
      <Text style={styles.meta}>{m.count} decisions</Text>
    </View>)}</View>
  </Section>;
}

function InsightSections({ data,onReview,detail,detailPhase,onClose }: {
  data:DraftInsights;onReview:(item:InsightHighlight)=>void;detail:InsightDecision|null;
  detailPhase:'idle'|'loading'|'ready'|'error';onClose:()=>void;
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
      detail={detail} detailPhase={detailPhase} onClose={onClose}/>:null}
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
  const detailTicket=useRef(0);
  const requestId = useRef(0);
  const activeOwner = useRef('');

  const load = useCallback(async () => {
    const id = ++requestId.current;
    detailTicket.current+=1;
    setDetail(null);
    setDetailPhase('idle');
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
          onReview={reviewDetail} onClose={closeDetail}/>
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
