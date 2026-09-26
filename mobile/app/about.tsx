import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/theme';

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.action}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export default function AboutScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>ABOUT</Text>
          <Text style={styles.title}>About Pack One</Text>
          <Text style={styles.deck}>Eight decisions from real trophy drafts.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Make a pick, then compare.</Text>
          <Text style={styles.body}>
            Pack One is a short Limited decision game. Play eight independent decisions from qualified trophy drafts, with the original drafter&apos;s earlier cards visible. Lock your choice before seeing their pick and the model&apos;s alternatives.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Three Dailies, ready to play.</Text>
          <Text style={styles.body}>
            Daily Draft Run, Daily Powered Cube, and Daily Latest Set are free, fixed challenges shared by everyone that day. No account is needed to play, score or share. A free account adds leaderboard participation and unlimited regular random practice.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>The trophy pick is the target.</Text>
          <Text style={styles.body}>
            100 means you matched the trophy drafter. Other choices receive up to 95 based on model support. An excellent alternative can differ from the choice made in that successful draft.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Independence and attribution.</Text>
          <Text style={styles.body}>
            Pack One adapts 17Lands public archives, licensed under CC BY 4.0, into puzzles, statistics and model evidence. Card metadata and images come from Scryfall. Magic: The Gathering card names, art, symbols, trademarks, and related intellectual property belong to Wizards of the Coast and other applicable rights holders. No endorsement by 17Lands or Scryfall is implied.
          </Text>
          <Text style={styles.body}>
            Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy. Not approved or endorsed by Wizards. See the canonical Terms for full attribution and source-license information.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Product and support</Text>
          <Text style={styles.body}>For bug reports, methodology questions, data corrections, accessibility issues, or feature requests:</Text>
          <Action label="admin@packone.pro" onPress={() => void Linking.openURL('mailto:admin@packone.pro')} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Partnerships and business</Text>
          <Action label="partner@packone.pro" onPress={() => void Linking.openURL('mailto:partner@packone.pro')} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Policies & sources</Text>
          <Action label="Privacy Policy" onPress={() => void WebBrowser.openBrowserAsync('https://packone.pro/privacy/')} />
          <Action label="Terms" onPress={() => void WebBrowser.openBrowserAsync('https://packone.pro/terms/')} />
          <Action label="17Lands public datasets" onPress={() => void WebBrowser.openBrowserAsync('https://www.17lands.com/public_datasets')} />
          <Action label="Scryfall" onPress={() => void WebBrowser.openBrowserAsync('https://scryfall.com/')} />
          <Action label="Wizards Fan Content Policy" onPress={() => void WebBrowser.openBrowserAsync('https://company.wizards.com/en/legal/fancontentpolicy')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl, alignSelf: 'center', width: '100%', maxWidth: 860 },
  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  deck: { color: colors.muted, fontSize: 17, lineHeight: 25 },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  action: { minHeight: 42, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { color: colors.accentDark, fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' },
});
