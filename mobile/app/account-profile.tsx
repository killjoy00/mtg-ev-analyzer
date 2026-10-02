import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { updateMobileProfile } from '@/src/api/career';
import { useAccountState } from '@/src/hooks/useAccountState';
import { colors, spacing } from '@/src/theme';

export default function AccountProfileScreen() {
  const {
    session,
    account,
    profile,
    catalogSets,
    busy,
    enrichmentBusy,
    enrichmentWarning,
    refresh,
  } = useAccountState({ requireAccount: true, loadProfile: true, loadCatalog: true });
  const [displayNameEdit, setDisplayName] = useState<string | null>(null);
  const [profilePublicEdit, setProfilePublic] = useState<boolean | null>(null);
  const [favoriteSetIdEdit, setFavoriteSetId] = useState<string | null>(null);
  const [showcaseAchievementEdit, setShowcaseAchievement] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const displayName = displayNameEdit ?? profile?.player.display_name ?? '';
  const profilePublic = profilePublicEdit ?? Boolean(profile?.player.profile_public);
  const favoriteSetId = favoriteSetIdEdit ?? profile?.player.favorite_set_id ?? '';
  const showcaseAchievement = showcaseAchievementEdit ?? profile?.player.showcase_achievement ?? '';

  const favorites = useMemo(() => [...catalogSets].sort((a, b) => (
    String(b.release_date ?? '').localeCompare(String(a.release_date ?? ''))
      || a.set_name.localeCompare(b.set_name)
  )), [catalogSets]);
  const unlocked = (profile?.achievements ?? []).filter((item) => item.unlocked);
  const reason = profile?.player.display_name_reason || profile?.ranking_identity?.reason || null;

  const save = async () => {
    if (!session?.accountToken || !profile || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateMobileProfile(session, {
        displayName: displayName.trim(),
        profilePublic,
        favoriteSetId: favoriteSetId || null,
        showcaseAchievement: showcaseAchievement || null,
        acceptPublicIdentityTerms: true,
      });
      if (updated.player.username_owned === false) {
        setMessage(updated.player.display_name_reason === 'name_not_allowed'
          ? 'That display name is not allowed. Choose another to join Daily leaderboards.'
          : 'Choose a different display name. That one is already taken.');
      } else {
        setMessage('Profile settings saved.');
      }
      await refresh();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile settings.');
    } finally {
      setSaving(false);
    }
  };

  if (busy || enrichmentBusy || !account || !profile) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.body}>Loading profile settings...</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>PROFILE &amp; VISIBILITY</Text>
        <Text style={styles.title}>How you appear in Pack One</Text>

        {profile.player.public_identity_hidden ? (
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>Display name hidden</Text>
            <Text style={styles.body}>
              {profile.player.public_identity_hidden_reason || 'Contact Pack One support if you believe this is a mistake.'}
            </Text>
          </View>
        ) : reason === 'name_not_allowed' ? (
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>Display name needs attention</Text>
            <Text style={styles.body}>That display name is not allowed. Choose another to join Daily leaderboards.</Text>
          </View>
        ) : reason === 'username_taken' ? (
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>Display name needs attention</Text>
            <Text style={styles.body}>Choose a different display name. That one is already taken.</Text>
          </View>
        ) : reason === 'username_required' ? (
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>Display name needs attention</Text>
            <Text style={styles.body}>Choose a display name to join Daily leaderboards.</Text>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput
            accessibilityLabel="Display name"
            autoCapitalize="words"
            autoComplete="nickname"
            maxLength={24}
            editable={!profile.player.public_identity_hidden}
            onChangeText={setDisplayName}
            placeholder="Display name"
            placeholderTextColor={colors.faint}
            style={styles.input}
            value={displayName}
          />
          <Text style={styles.help}>Shown on Daily leaderboards and your public profile.</Text>

          {!profile.player.public_identity_hidden ? (
            <View style={styles.termsBox}>
              <Text style={styles.help}>
                By saving a display name or public profile, you agree to the Public Identity rules:
                no harassment, impersonation, spam, private contact information, or abusive content.
              </Text>
              <Pressable accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync('https://packone.pro/terms/#public-identity-rules')}>
                <Text style={styles.link}>Read the Public Identity rules</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: profilePublic, disabled: Boolean(profile.player.public_identity_hidden) }}
            disabled={Boolean(profile.player.public_identity_hidden)}
            onPress={() => setProfilePublic(!profilePublic)}
            style={[styles.toggle, profilePublic && styles.toggleActive]}
          >
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleTitle}>Public profile</Text>
              <Text style={styles.help}>Allows leaderboard visitors and shared links to open your Pack One record.</Text>
            </View>
            <Text style={[styles.toggleValue, profilePublic && styles.toggleValueActive]}>{profilePublic ? 'ON' : 'OFF'}</Text>
          </Pressable>

          <Text style={styles.fieldLabel}>Favorite environment</Text>
          <View style={styles.optionGrid}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: favoriteSetId === '' }}
              onPress={() => setFavoriteSetId('')} style={[styles.optionChip, favoriteSetId === '' && styles.optionChipSelected]}>
              <Text style={[styles.optionText, favoriteSetId === '' && styles.optionTextSelected]}>No favorite</Text>
            </Pressable>
            {favorites.map((item) => (
              <Pressable key={item.set_id} accessibilityRole="button" accessibilityState={{ selected: favoriteSetId === item.set_id }}
                onPress={() => setFavoriteSetId(item.set_id)}
                style={[styles.optionChip, favoriteSetId === item.set_id && styles.optionChipSelected]}>
                <Text style={[styles.optionText, favoriteSetId === item.set_id && styles.optionTextSelected]}>{item.set_name}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Showcase achievement</Text>
          <View style={styles.optionGrid}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: showcaseAchievement === '' }}
              onPress={() => setShowcaseAchievement('')}
              style={[styles.optionChip, showcaseAchievement === '' && styles.optionChipSelected]}>
              <Text style={[styles.optionText, showcaseAchievement === '' && styles.optionTextSelected]}>No showcase</Text>
            </Pressable>
            {unlocked.map((item) => (
              <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: showcaseAchievement === item.id }}
                onPress={() => setShowcaseAchievement(item.id)}
                style={[styles.optionChip, showcaseAchievement === item.id && styles.optionChipSelected]}>
                <Text style={[styles.optionText, showcaseAchievement === item.id && styles.optionTextSelected]}>◆ {item.label}</Text>
              </Pressable>
            ))}
          </View>

          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          {enrichmentWarning ? <Text accessibilityRole="alert" style={styles.help}>{enrichmentWarning}</Text> : null}

          <Pressable accessibilityRole="button"
            disabled={saving || displayName.trim().length < 2 || Boolean(profile.player.public_identity_hidden)}
            onPress={() => void save()}
            style={[styles.primaryButton, (saving || displayName.trim().length < 2 || Boolean(profile.player.public_identity_hidden)) && styles.disabled]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save profile</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/career')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Open My Pack One</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, alignSelf: 'center', width: '100%', maxWidth: 760 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.6 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: spacing.md, fontSize: 16 },
  warning: { borderWidth: 1, borderLeftWidth: 4, borderColor: colors.accent, padding: spacing.md, gap: spacing.xs },
  warningTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  termsBox: { gap: spacing.sm },
  link: { color: colors.accentDark, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  toggle: { minHeight: 62, borderWidth: 1, borderColor: colors.lineStrong, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  toggleCopy: { flex: 1, gap: 3 },
  toggleTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  toggleValue: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  toggleValueActive: { color: colors.accentDark },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionChip: { minHeight: 40, maxWidth: '100%', borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  optionChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  optionTextSelected: { color: colors.accentDark },
  message: { color: colors.accentDark, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  primaryButton: { minHeight: 52, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.42 },
});
