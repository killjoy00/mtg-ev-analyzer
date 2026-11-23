import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { colors, spacing } from '@/src/theme';
import { themedStyles, useAppTheme } from '@/src/appearance';
import { CARD_SIZES, useCardSizePreference, writeCardSize } from '@/src/cardSize';

// Shared locally for guests and members. The future Appearance screen can
// host this without pulling the unrelated email/results preferences with it.
export function CardDisplaySettings() {
  useAppTheme();
  const { size, ready } = useCardSizePreference();
  return <View style={styles.section} accessibilityLabel="Card display preferences">
    <Text style={styles.heading}>Card size</Text>
    <Text style={styles.body}>Choose how many cards appear in each row.</Text>
    <View style={styles.choices} accessibilityRole="radiogroup">
      {CARD_SIZES.map(option => <Pressable key={option} testID={`settings-card-size-${option}`}
        accessibilityRole="radio" accessibilityLabel={`${option} card size`}
        accessibilityState={{ checked: ready && size === option, disabled: !ready }}
        disabled={!ready} onPress={() => void writeCardSize(option)}
        style={[styles.choice, ready && size === option && styles.choiceSelected]}>
        <Text style={[styles.choiceText, ready && size === option && styles.choiceTextSelected]}>
          {option === 'standard' ? 'Standard' : option === 'compact' ? 'Compact' : 'Large'}
        </Text>
      </Pressable>)}
    </View>
  </View>;
}

const styles = themedStyles(StyleSheet.create({
  section: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  choiceSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choiceText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  choiceTextSelected: { color: colors.accentDark, fontWeight: '800' },
}));
