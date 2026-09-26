import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { connectNativePatreon, loadNativePatreonStatus, mutateNativePatreon } from '@/src/api/patreon';
import { useAppResume } from '@/src/hooks/useAppResume';
import { accountAccessLabel, createMembershipController, initialMembershipState } from '@/src/state/membership';
import { readSession, subscribeSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

export default function MembershipScreen() {
  const [state, setState] = useState(initialMembershipState);
  const [controller] = useState(() => createMembershipController({
    readSession,
    load: loadNativePatreonStatus,
    connect: connectNativePatreon,
    mutate: mutateNativePatreon,
    openBrowser: (url) => WebBrowser.openBrowserAsync(url),
    changed: setState,
  }));

  useEffect(() => {
    controller.activate();
    const unsubscribe = subscribeSession((next) => controller.sessionChanged(next));
    return () => { unsubscribe(); controller.dispose(); };
  }, [controller]);
  useFocusEffect(useCallback(() => {
    controller.activate();
    void controller.check();
    return () => controller.pause();
  }, [controller]));
  useAppResume(() => controller.check());

  const current = state.phase === 'ready' ? state.data : null;
  const confirmDisconnect = () => {
    if (!current?.connected || state.busy) return;
    const { account_user_id: accountUserId, player_id: playerId } = current;
    Alert.alert('Disconnect Patreon?',
      'This removes only Patreon-provided access in Pack One. Other account access is kept. This does not cancel billing at Patreon.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void controller.disconnect(accountUserId, playerId) },
      ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>PACK ONE MEMBERSHIP</Text>
        <Text style={styles.title}>Your account access</Text>
        <View style={styles.panel}>
          <Text style={styles.heading}>{accountAccessLabel(state)}</Text>
          {state.busy ? <ActivityIndicator accessibilityLabel="Checking membership" /> : null}
          {state.phase === 'loading' ? <Text style={styles.body}>Checking access for the current signed-in account...</Text> : null}
          {current ? (
            <>
              <Text style={styles.body}>Regular Draft Run practice: included</Text>
              <Text style={styles.body}>Powered Cube practice: {current.account_capabilities.includes('unlimited_cube_practice') ? 'available' : 'not currently included'}</Text>
              <Text style={styles.body}>Custom-set practice: {current.account_capabilities.includes('custom_corpus') ? 'available' : 'not currently included'}</Text>
              <Text style={styles.help}>This is the same provider-independent account access checked by gameplay. It is separate from your Patreon connection.</Text>
            </>
          ) : state.phase === 'error' ? (
            <Text style={styles.body}>Access is not verified right now. A failed lookup does not mean your account is Free or that access was removed.</Text>
          ) : null}
        </View>

        {current ? (
          <View style={styles.panel}>
            <Text style={styles.heading}>Patreon connection</Text>
            <Text style={styles.body}>{current.connected ? 'Patreon is connected to this account.' : 'No Patreon account is connected.'}</Text>
            {!current.configured ? <Text style={styles.body}>Patreon connection service is unavailable. Account access above remains a separate check.</Text> : null}
            {current.membership?.sync_pending ? (
              <Text style={styles.body}>Membership reconciliation is pending. A refresh request is not confirmation of a completed sync.</Text>
            ) : current.connected ? (
              <Text style={styles.body}>Patreon-provided access: {current.capabilities.includes('custom_corpus') && current.capabilities.includes('unlimited_cube_practice')
                ? 'Elite grants are currently active.' : current.capabilities.length ? 'Some practice grants are active.' : 'no currently active Elite grants.'}</Text>
            ) : null}
            {current.membership?.last_synced_at ? <Text style={styles.help}>Last provider sync: {current.membership.last_synced_at}</Text> : null}
            {current.configured ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Connect existing Patreon membership" disabled={state.busy}
                onPress={() => void controller.connect()} style={[styles.button, state.busy && styles.disabled]}>
                <Text style={styles.buttonText}>{current.connected ? 'Reconnect existing Patreon membership' : 'Connect existing Patreon membership'}</Text>
              </Pressable>
            ) : null}
            {current.connected && current.configured ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Request Patreon refresh" disabled={state.busy}
                onPress={() => void controller.refresh()} style={[styles.button, state.busy && styles.disabled]}>
                <Text style={styles.buttonText}>Request Patreon refresh</Text>
              </Pressable>
            ) : null}
            {current.connected ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Disconnect Patreon" disabled={state.busy}
                onPress={confirmDisconnect} style={[styles.button, state.busy && styles.disabled]}>
                <Text style={styles.buttonText}>Disconnect Patreon</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
        {state.notice ? <Text accessibilityRole="alert" style={styles.body}>{state.notice}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Check membership status" disabled={state.busy}
          onPress={() => void controller.check()} style={[styles.button, state.busy && styles.disabled]}>
          <Text style={styles.buttonText}>Check status</Text>
        </Pressable>
        {state.phase === 'guest' ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.button}>
            <Text style={styles.buttonText}>Sign in to manage membership</Text>
          </Pressable>
        ) : null}
        <Text style={styles.help}>This screen manages an existing connection and account access. It does not sell memberships or upgrades.</Text>
        <Text style={styles.help}>When authorization finishes, close the browser and return here. Check status verifies the current account; a browser message alone does not grant access.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: '800' },
  panel: { padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  body: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 23 },
  button: { minHeight: 48, padding: spacing.md, borderWidth: 1, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
