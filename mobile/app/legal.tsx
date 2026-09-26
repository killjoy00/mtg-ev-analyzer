import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/theme';

const docs = {
  privacy: { title: 'Privacy Policy', url: 'https://packone.pro/privacy/' },
  terms: { title: 'Terms', url: 'https://packone.pro/terms/' },
  disclosure: { title: 'Disclosure', url: 'https://packone.pro/disclosure/' },
} as const;

export default function LegalScreen() {
  const params = useLocalSearchParams<{ doc?: string }>();
  const key = typeof params.doc === 'string' && params.doc in docs ? params.doc as keyof typeof docs : 'privacy';
  const item = useMemo(() => docs[key], [key]);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let active = true;
    void WebBrowser.openBrowserAsync(item.url).finally(() => {
      if (active) setOpened(true);
    });
    return () => { active = false; };
  }, [item.url]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.kicker}>PACK ONE</Text>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.body}>
          {opened
            ? 'The canonical Pack One policy opened in the secure browser. This keeps legal copy identical across web and native.'
            : 'Opening the canonical Pack One policy…'}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(item.url)} style={styles.button}>
          <Text style={styles.buttonText}>Open {item.title}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { flex: 1, padding: spacing.xl, gap: spacing.md, justifyContent: 'center', alignSelf: 'center', width: '100%', maxWidth: 640 },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  button: { minHeight: 50, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
