import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea } from '@/src/components/ScreenArea';
import { CardFaceViewer } from '@/src/components/CardFaceViewer';
import type { TrophyDeck, TrophyDeckCard } from '@/src/api/draftRun';
import { colors, spacing } from '@/src/theme';
import {
  DECK_LICENSE_URL,
  DECK_SOURCE_URL,
  deckColorText,
  deckCurve,
  deckDraftUrl,
  deckGroups,
  deckMeta,
  manaSymbols,
  sideboardCount,
  type DeckContext,
} from '@/src/trophyDeck';

type DeckState = { status: 'loading' } | { status: 'ready'; deck: TrophyDeck } | { status: 'error' };

const MANA_COLORS: Record<string, string> = { W: '#eee6cd', U: '#afcddd', B: '#c1b7c5', R: '#dfb29f', G: '#a6c6ad' };

function ManaCost({ cost }: { cost?: string }) {
  const symbols = manaSymbols(cost);
  if (!symbols.length) return null;
  return <View accessible accessibilityLabel={cost} style={styles.cost}>
    {symbols.map((symbol, index) => <View key={`${symbol}-${index}`} style={[styles.mana, { backgroundColor: MANA_COLORS[symbol] ?? '#cbd1d5' }]}>
      <Text style={styles.manaText}>{symbol}</Text>
    </View>)}
  </View>;
}

function Disclosure({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress} style={styles.disclosure}>
    <Text style={styles.disclosureText}>{open ? '▾' : '▸'} {label}</Text>
  </Pressable>;
}

function DeckBody({ deck, context, onZoom }: { deck: TrophyDeck; context: DeckContext; onZoom: (card: TrophyDeckCard) => void }) {
  const [sideboard, setSideboard] = useState(false);
  const [about, setAbout] = useState(false);
  const colorsText = deckColorText(deck);
  const draftUrl = deckDraftUrl(deck);
  const curve = deckCurve(deck);
  const max = Math.max(1, ...curve);
  const open = (url: string) => { void Linking.openURL(url).catch(() => undefined); };
  return <>
    <Text style={styles.meta}>{deckMeta(deck, context.record)}</Text>
    {colorsText ? <Text style={styles.meta}>{colorsText}</Text> : null}
    {draftUrl ? <Pressable accessibilityRole="link" onPress={() => open(draftUrl)} style={styles.link}>
      <Text style={styles.linkText}>View full draft on 17Lands</Text>
    </Pressable> : null}
    <View accessible accessibilityLabel={`Mana curve: ${curve.map((count, value) => `${count} at ${value === 7 ? '7 or more' : value}`).join(', ')}`} style={styles.curve}>
      {curve.map((count, value) => <View key={value} style={styles.curveColumn}>
        <Text style={styles.curveCount}>{count || ''}</Text>
        <View style={[styles.curveBar, { height: Math.max(2, Math.round(56 * count / max)) }]} />
        <Text style={styles.curveCount}>{value === 7 ? '7+' : value}</Text>
      </View>)}
    </View>
    {deckGroups(deck, context).map((group) => <View key={group.label} style={styles.group}>
      <Text accessibilityRole="header" style={styles.groupTitle}>{group.label.toUpperCase()} · {group.count}</Text>
      {group.rows.map((card) => <View key={card.id} style={[styles.row, card.tag === 'Trophy pick' && styles.trophyRow]}>
        <Text style={styles.count}>{card.count}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${card.count} ${card.name}${card.tag ? `, ${card.tag.toLowerCase()}` : ''}. Open enlarged card.`}
          onPress={() => onZoom(card)} style={styles.rowName}>
          <Text style={styles.cardName}>{card.name}{card.tag ? <Text style={card.tag === 'Trophy pick' ? styles.trophyTag : styles.earlierTag}>{`  ${card.tag}`}</Text> : null}</Text>
        </Pressable>
        <ManaCost cost={card.mana_cost} />
      </View>)}
    </View>)}
    {deck.sideboard.length ? <>
      <Disclosure label={`Sideboard (${sideboardCount(deck)})`} open={sideboard} onPress={() => setSideboard((value) => !value)} />
      {sideboard ? deck.sideboard.map((card) => <View key={`side-${card.id}`} style={styles.row}>
        <Text style={styles.count}>{card.count}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${card.count} ${card.name}. Open enlarged card.`} onPress={() => onZoom(card)} style={styles.rowName}>
          <Text style={styles.cardName}>{card.name}</Text>
        </Pressable>
      </View>) : null}
    </> : null}
    <View style={styles.source}>
      <Text style={styles.meta}>Source: </Text>
      <Pressable accessibilityRole="link" onPress={() => open(DECK_SOURCE_URL)}><Text style={styles.sourceLink}>17Lands public datasets</Text></Pressable>
      <Text style={styles.meta}> · </Text>
      <Pressable accessibilityRole="link" onPress={() => open(DECK_LICENSE_URL)}><Text style={styles.sourceLink}>CC BY 4.0</Text></Pressable>
    </View>
    <Disclosure label="About this deck" open={about} onPress={() => setAbout((value) => !value)} />
    {about ? <Text style={styles.meta}>{deck.source.note}</Text> : null}
  </>;
}

// Mounted only while the sheet is open, so every open starts from loading and
// a closed sheet never applies a late response.
function DeckLoader({ load, context }: { load: () => Promise<TrophyDeck>; context: DeckContext }) {
  const [state, setState] = useState<DeckState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [zoomed, setZoomed] = useState<TrophyDeckCard | null>(null);
  useEffect(() => {
    let current = true;
    load().then(
      (deck) => { if (current) setState({ status: 'ready', deck }); },
      () => { if (current) setState({ status: 'error' }); },
    );
    return () => { current = false; };
  }, [load, attempt]);
  const retry = () => { setState({ status: 'loading' }); setAttempt((value) => value + 1); };
  return <>
    <ScrollView contentContainerStyle={styles.body}>
      {state.status === 'loading' ? <View accessibilityLiveRegion="polite" style={styles.status}>
        <ActivityIndicator color={colors.accent} /><Text style={styles.meta}>Loading decklist…</Text>
      </View> : state.status === 'error' ? <View style={styles.status}>
        <Text accessibilityRole="alert" style={styles.error}>Couldn’t load the decklist.</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={styles.close}><Text style={styles.closeText}>Try again</Text></Pressable>
      </View> : <DeckBody deck={state.deck} context={context} onZoom={setZoomed} />}
    </ScrollView>
    {/* Rendered inside this modal so the card opens above the list on iOS too. */}
    <CardFaceViewer card={zoomed} onClose={() => setZoomed(null)} />
  </>;
}

// Native counterpart of the web trophy-deck dialog. The list is fetched only
// when opened, and a failed read offers a retry without leaving the reveal.
export function TrophyDeckSheet({ visible, load, context, onClose }: {
  visible: boolean;
  load: () => Promise<TrophyDeck>;
  context: DeckContext;
  onClose: () => void;
}) {
  return <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
    <ScreenArea edges={['top', 'right', 'bottom', 'left']} style={styles.safe}>
      <View accessibilityViewIsModal style={styles.sheet}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Trophy Drafter’s Decklist</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close decklist" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        {visible ? <DeckLoader load={load} context={context} /> : null}
      </View>
    </ScreenArea>
  </Modal>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'rgba(16, 24, 32, 0.58)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '94%', backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, width: '100%', maxWidth: 720, alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.sm },
  title: { flex: 1, color: colors.ink, fontSize: 22, lineHeight: 27, fontWeight: '800' },
  close: { minHeight: 44, borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  status: { gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.md },
  error: { color: colors.danger, fontSize: 15, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.accentDark, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  curve: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.line },
  curveColumn: { alignItems: 'center', width: 28, gap: 3 },
  curveBar: { width: 22, backgroundColor: '#6886a0' },
  curveCount: { color: colors.muted, fontSize: 11 },
  group: { gap: 0, marginTop: spacing.sm },
  groupTitle: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.7, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, borderBottomWidth: 1, borderColor: colors.line },
  trophyRow: { backgroundColor: '#eaf2f8', borderColor: '#bfd2e2', borderWidth: 1, paddingHorizontal: spacing.xs },
  count: { width: 20, color: colors.muted, fontSize: 13 },
  rowName: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  cardName: { color: colors.accentDark, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  trophyTag: { color: '#214f7d', fontSize: 11, fontWeight: '800' },
  earlierTag: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  cost: { flexDirection: 'row', gap: 2 },
  mana: { minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  manaText: { color: '#20262c', fontSize: 10, fontWeight: '700' },
  disclosure: { minHeight: 44, justifyContent: 'center' },
  disclosureText: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  source: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: spacing.md },
  sourceLink: { color: colors.accentDark, fontSize: 13, lineHeight: 19, textDecorationLine: 'underline' },
});
