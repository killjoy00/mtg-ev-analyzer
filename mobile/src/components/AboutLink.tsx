import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/src/components/Text';
import { colors, spacing } from '@/src/theme';

export function AboutLink() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="About Pack One"
      onPress={() => router.push('/about')}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={styles.text}>About</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  pressed: { opacity: 0.72 },
  text: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
});
