import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ArticleScreen } from '@/src/components/ArticleScreen';
import { Text } from '@/src/components/Text';
import { supportSections } from '@/src/nativeEditorial';
import { colors, spacing } from '@/src/theme';

export default function SupportScreen() {
  const [error, setError] = useState<string | null>(null);
  const email = async (address: string) => {
    setError(null);
    try { await Linking.openURL(`mailto:${address}`); }
    catch { setError(`Could not open your email app. Email ${address} directly.`); }
  };

  return (
    <ArticleScreen
      kicker="Contact"
      title="Contact Pack One"
      deck="Contact Pack One for product support, data corrections, methodology questions, and business inquiries."
      sections={supportSections}
      footer={(
        <View style={styles.actions}>
          <Pressable accessibilityRole="link" onPress={() => void email('admin@packone.pro')} style={styles.button}>
            <Text style={styles.buttonText}>Email product support</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => void email('partner@packone.pro')} style={styles.button}>
            <Text style={styles.buttonText}>Email partnerships</Text>
          </Pressable>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  button: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
});
