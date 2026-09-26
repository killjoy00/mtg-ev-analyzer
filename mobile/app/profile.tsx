import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { loadMobilePublicProfile, type CareerProfile } from '@/src/api/career';
import { ensureGuestSession } from '@/src/api/guest';
import { ProfileOverview } from '@/src/components/ProfileOverview';
import { colors, spacing } from '@/src/theme';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: CareerProfile };

export default function PublicProfileScreen() {
  const params = useLocalSearchParams<{ key?: string }>();
  const profileKey = typeof params.key === 'string' ? params.key : '';
  const validProfileKey = /^[a-f0-9]{16}$/.test(profileKey);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!validProfileKey) return () => { active = false; };
    void ensureGuestSession()
      .then((session) => loadMobilePublicProfile(profileKey, session))
      .then((profile) => {
        if (active) setState({ status: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (active) setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'This public profile is unavailable.',
        });
      });
    return () => { active = false; };
  }, [profileKey, validProfileKey]);

  if (!validProfileKey) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Profile unavailable</Text>
          <Text style={styles.body}>This public profile link is invalid.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>Loading player profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Profile unavailable</Text>
          <Text style={styles.body}>{state.message}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <ProfileOverview profile={state.profile} publicView />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, alignSelf: 'center', width: '100%', maxWidth: 980 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
