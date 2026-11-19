import { router } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Text } from '@/src/components/Text';
import { colors, spacing } from '@/src/theme';

type Section = 'stats' | 'insights' | 'account';

const sections: { id: Section; label: string }[] = [
  { id: 'stats', label: 'Stats' },
  { id: 'insights', label: 'Insights' },
  { id: 'account', label: 'Account settings' },
];

function navigateTo(section: Section) {
  if (section === 'stats') router.dismissTo('/career');
  else if (section === 'insights') router.push('/insights');
  else router.push('/account');
}

/** Keep the labels at the user's chosen text size instead of squeezing three tabs into narrow columns. */
export function MyPackSectionTabs({ active }: { active: Section }) {
  const { width, fontScale } = useWindowDimensions();
  // Full-width rows make room for Dynamic Type on phones and at accessibility sizes.
  // Preserve the familiar horizontal tabs on regular-size text and roomy tablets.
  const stacked = fontScale > 1.25 && width / fontScale < 480;

  return (
    <View accessibilityLabel="My Pack One sections" style={[styles.tabs, stacked && styles.tabsStacked]}>
      {sections.map(({ id, label }) => {
        const selected = id === active;
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={selected ? undefined : () => navigateTo(id)}
            style={[styles.tab, stacked && styles.tabStacked, selected && styles.tabSelected,
              stacked && selected && styles.tabSelectedStacked]}>
            <Text style={[styles.tabText, stacked && styles.tabTextStacked,
              selected && styles.tabTextSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  tabsStacked: { flexDirection: 'column', borderBottomWidth: 0 },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  tabStacked: { flex: 0, width: '100%', minHeight: 52, alignItems: 'stretch',
    paddingHorizontal: spacing.md, borderBottomWidth: 1, borderColor: colors.line },
  tabSelected: { borderBottomWidth: 3, borderColor: colors.accent },
  tabSelectedStacked: { borderBottomWidth: 1, borderBottomColor: colors.line,
    borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.accentSoft },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  tabTextStacked: { textAlign: 'left' },
  tabTextSelected: { color: colors.ink },
});
