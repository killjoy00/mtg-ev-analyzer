import * as Application from 'expo-application';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestJson } from '@/src/api/client';
import { colors, spacing } from '@/src/theme';
import {
  parseVersionCheckResponse,
  type MobilePlatform,
  type VersionGateDecision,
} from '@/src/versionPolicy';

type GateState = 'checking' | VersionGateDecision;

function nativePlatform(): MobilePlatform | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  return null;
}

async function checkInstalledVersion(): Promise<VersionGateDecision> {
  const platform = nativePlatform();
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;

  // Development/web shells or an unexpected native metadata failure must not
  // strand a client. Store binaries provide both values.
  if (!platform || !version || !build) return { status: 'allowed' };

  try {
    const params = new URLSearchParams({ platform, version, build });
    const response = await requestJson<unknown>(`/growth/v1/mobile/version?${params.toString()}`, {
      timeoutMs: 5_000,
    });
    return parseVersionCheckResponse(platform, response) ?? { status: 'allowed' };
  } catch {
    // Fail open on transport/server outages. A block is allowed only when a
    // valid server response explicitly marks this installed binary unsupported.
    return { status: 'allowed' };
  }
}

function CheckingScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.kicker}>PACK ONE</Text>
        <Text style={styles.title}>Checking app version…</Text>
      </View>
    </SafeAreaView>
  );
}

function UpdateRequiredScreen({
  storeUrl,
  minimum,
}: Extract<VersionGateDecision, { status: 'required' }>) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.updateCard}>
        <Text style={styles.kicker}>UPDATE REQUIRED</Text>
        <Text style={styles.title}>A newer Pack One build is required.</Text>
        <Text style={styles.body}>
          This installed version is no longer supported for Pack One&apos;s current game and account services.
          Update the app to continue.
        </Text>
        <Text style={styles.minimum}>
          Minimum supported: {minimum.marketingVersion} (build {minimum.build})
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Update Pack One"
          onPress={() => {
            void Linking.openURL(storeUrl).catch(() => undefined);
          }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>Update Pack One</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function VersionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking');
  const mounted = useRef(true);
  const previousState = useRef<AppStateStatus>(AppState.currentState);

  const refresh = useCallback(async () => {
    setState('checking');
    const next = await checkInstalledVersion();
    if (mounted.current) setState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = previousState.current;
      previousState.current = nextState;
      if ((previous === 'inactive' || previous === 'background') && nextState === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  if (state === 'checking') return <CheckingScreen />;
  if (state.status === 'required') {
    return <UpdateRequiredScreen storeUrl={state.storeUrl} minimum={state.minimum} />;
  }
  return children;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  updateCard: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  kicker: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
  },
  body: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  minimum: {
    color: colors.faint,
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '800',
  },
  pressed: { opacity: 0.78 },
});
