import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { setArchive } from '@/src/content/setArchives';
import { tcgplayerUrl } from '@/src/tcgplayer';
import { colors, spacing } from '@/src/theme';

function formatNumber(value: number) {
  return value.toLocaleString();
}

export default function SetArchiveScreen() {
  const params = useLocalSearchParams<{ setId?: string }>();
  const setId = typeof params.setId === 'string' ? params.setId.toLowerCase() : '';
  const archive = setArchive(setId);

  if (!archive) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.kicker}>SET ARCHIVE</Text>
          <Text style={styles.title}>Archive analysis unavailable.</Text>
          <Text style={styles.body}>This set does not currently have a published Pack One editorial archive.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/sets')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to Sets</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const code = archive.setId.toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>SET ARCHIVE</Text>
          <Text style={styles.title}>{code} Pack One archive</Text>
          <Text style={styles.deck}>
            Original analysis of {archive.replaySeats} {code} replay seats: consensus confidence, close calls, recurring opening-pick leaders, and model context.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What is in the {code} sample?</Text>
          <Text style={styles.body}>
            This archive uses {archive.replaySeats} historical replay seats. The consensus model for this set was trained from {formatNumber(archive.trainingDrafts)} drafts and {formatNumber(archive.trainingPicks)} picks drawn from an experienced cohort of {formatNumber(archive.experiencedCohortDrafts)} drafts. The recorded win-rate cutoff for the cohort is {archive.winRateCutoff}.
          </Text>
          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{archive.averageTopSupport}</Text>
              <Text style={styles.metricLabel}>Average support for #1</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{archive.withinTenPoints}</Text>
              <Text style={styles.metricLabel}>Opening packs within 10 pts</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{archive.historicalTopMatch}</Text>
              <Text style={styles.metricLabel}>Historical pick matched #1</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How decisive were the opening packs?</Text>
          <Text style={styles.body}>
            Across these replay seats, the model&apos;s average gap between its first and second cards was {archive.averageGap}. {archive.withinTenPoints} of packs had a gap of ten support points or less, while {archive.thirtyPointGap} had a gap of thirty points or more. That split is useful when reviewing a miss: a narrow disagreement is not the same signal as passing a card the model strongly separated from the field.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cards that most often led the opening pack</Text>
          <Text style={styles.body}>
            These are not a set ranking or a pick-order list. They are the cards that appeared as the model&apos;s most-supported card most often in this particular {archive.replaySeats}-seat replay sample. Frequency depends on which cards were opened.
          </Text>
          <View style={styles.cardGrid}>
            {archive.topCards.map((card) => (
              <View key={card.name} style={styles.marketCard}>
                <Image
                  source={card.imageUrl}
                  style={styles.cardImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  accessibilityLabel={card.name}
                />
                <Text style={styles.cardName}>{card.name}</Text>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Find ${card.name} on TCGplayer, affiliate link`}
                  onPress={() => void Linking.openURL(tcgplayerUrl(card.name))}
                  style={styles.shopLink}
                >
                  <Text style={styles.shopLinkText}>TCGplayer (affiliate link)</Text>
                </Pressable>
              </View>
            ))}
          </View>
          <Text style={styles.disclosure}>
            Affiliate disclosure: TCGplayer links are marked sponsored. Pack One may earn a commission from eligible purchases made through these TCGplayer affiliate links, at no added cost to the buyer.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Three of the closest opening decisions in the archive</Text>
          <Text style={styles.body}>
            These packs produced the smallest support gaps between the top two cards in the sample. They are especially useful challenge packs because the model itself expresses little separation.
          </Text>
          <View style={styles.closeList}>
            {archive.closeDecisions.map((decision, index) => (
              <View key={`${decision.first}:${decision.second}`} style={styles.closeRow}>
                <Text style={styles.closeIndex}>{index + 1}</Text>
                <View style={styles.closeCopy}>
                  <Text style={styles.closeTitle}>{decision.first}</Text>
                  <Text style={styles.closeMeta}>{decision.firstSupport} support</Text>
                  <Text style={styles.closeVersus}>vs. {decision.second} · {decision.secondSupport}</Text>
                </View>
                <Text style={styles.gap}>{decision.gap} gap</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How to use this page</Text>
          <Text style={styles.body}>
            Use the statistics to calibrate your expectations before treating a score as a verdict. A set with many close opening decisions should naturally produce more reasonable disagreement. The archive is descriptive of the stored replay sample and model version; it is not a complete ranking of every card or every possible pack.
          </Text>
        </View>

        <View style={styles.cta}>
          <Text style={styles.kicker}>PUT IT INTO PRACTICE</Text>
          <Text style={styles.sectionTitle}>Make the decision before you read the answer.</Text>
          <Text style={styles.body}>
            Pack One is most useful when you commit first, then use the consensus as a comparison point, not an instruction sheet.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/practice')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Open Practice</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl, alignSelf: 'center', width: '100%', maxWidth: 980 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  hero: { gap: spacing.sm },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  deck: { color: colors.muted, fontSize: 17, lineHeight: 25, maxWidth: 760 },
  section: { gap: spacing.md },
  sectionTitle: { color: colors.ink, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flexGrow: 1, flexBasis: '30%', minWidth: 150, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.xs },
  metricValue: { color: colors.ink, fontSize: 25, fontWeight: '800' },
  metricLabel: { color: colors.muted, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  marketCard: { width: 166, maxWidth: '48%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.sm, gap: spacing.xs },
  cardImage: { width: '100%', aspectRatio: 0.716, backgroundColor: colors.surfaceSoft },
  cardName: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  shopLink: { minHeight: 38, justifyContent: 'center' },
  shopLinkText: { color: colors.accentDark, fontSize: 12, lineHeight: 16, fontWeight: '800', textDecorationLine: 'underline' },
  disclosure: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  closeList: { gap: spacing.xs },
  closeRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: spacing.md },
  closeIndex: { width: 24, color: colors.accentDark, fontSize: 16, fontWeight: '800' },
  closeCopy: { flex: 1, gap: 2 },
  closeTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  closeMeta: { color: colors.muted, fontSize: 12 },
  closeVersus: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  gap: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  cta: { backgroundColor: colors.accentSoft, borderLeftWidth: 3, borderLeftColor: colors.accent, padding: spacing.lg, gap: spacing.sm },
  primaryButton: { minHeight: 48, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, alignSelf: 'flex-start' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
