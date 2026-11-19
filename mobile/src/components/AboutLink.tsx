import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/src/components/Text';
import { colors, spacing } from '@/src/theme';

// A settings-style navigation row, not a loose link on every screen.
export function AboutLink() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="About Pack One"
      onPress={() => router.push('/about')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>About Pack One</Text>
        <Text style={styles.description}>Project details, credits, and legal information</Text>
      </View>
      <Text style={styles.arrow} accessible={false}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    minHeight: 68,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  arrow: { color: colors.muted, fontSize: 26, lineHeight: 30 },
  pressed: { opacity: 0.72 },
});
