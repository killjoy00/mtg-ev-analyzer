import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useRef, useState } from 'react';
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

import { ApiError } from '@/src/api/client';
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
    message: loadMessage,
    enrichmentWarning,
    refresh,
    adoptProfile,
  } = useAccountState({ requireAccount: true, loadProfile: true, loadCatalog: true });
  const [displayNameEdit, setDisplayName] = useState<string | null>(null);
  const [profilePublicEdit, setProfilePublic] = useState<boolean | null>(null);
  const [favoriteSetIdEdit, setFavoriteSetId] = useState<string | null>(null);
  const [showcaseAchievementEdit, setShowcaseAchievement] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveTone, setSaveTone] = useState<'success' | 'error' | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const displayNameRef = useRef<TextInput>(null);

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
    setSaveMessage('Saving profile…');
    setSaveTone(null);
    setDisplayNameError(null);
    try {
      const updated = await updateMobileProfile(session, {
        displayName: displayName.trim(),
        profilePublic,
        favoriteSetId: favoriteSetId || null,
        showcaseAchievement: showcaseAchievement || null,
        acceptPublicIdentityTerms: true,
      });
      adoptProfile(updated);
      setSaveTone('success');
      setSaveMessage('Profile saved.');
    } catch (error: unknown) {
      const body = error instanceof ApiError && error.body && typeof error.body === 'object'
        ? error.body as { code?: unknown }
        : null;
      const code = typeof body?.code === 'string' ? body.code : null;
      const nameError = code === 'USERNAME_NOT_ALLOWED'
        ? 'That display name is not allowed.'
        : code === 'USERNAME_TAKEN'
          ? 'That display name is already taken.'
          : null;
      if (nameError) setDisplayNameError(nameError);
      setSaveTone('error');
      setSaveMessage(nameError
        ? 'Profile not saved. Fix the display name and try again.'
        : `${error instanceof Error ? error.message : 'Could not save profile settings.'} Your edits are still here.`);
    } finally {
      setSaving(false);
    }
  };

  if (busy || enrichmentBusy) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.body}>Loading profile settings...</Text>
      </View>
    </SafeAreaView>
  );

  if (!account || !profile) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text accessibilityRole="alert" style={styles.message}>
          {loadMessage || enrichmentWarning || 'Could not load profile settings.'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.editorHeading}>
          <View style={styles.editorHeadingCopy}>
            <Text style={styles.eyebrow}>PROFILE &amp; VISIBILITY</Text>
            <Text style={styles.title}>How you appear in Pack One</Text>
          </View>
          <View style={styles.editorActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Change display name"
              onPress={() => displayNameRef.current?.focus()} style={styles.secondaryCompactButton}>
              <Text style={styles.secondaryButtonText}>Change name</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              disabled={saving || displayName.trim().length < 2 || Boolean(profile.player.public_identity_hidden)}
              onPress={() => void save()}
              style={[styles.primaryCompactButton, (saving || displayName.trim().length < 2 || Boolean(profile.player.public_identity_hidden)) && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save profile</Text>}
            </Pressable>
            {saveMessage ? (
              <Text accessibilityRole={saveTone === 'error' ? 'alert' : undefined}
                style={[styles.saveStatus, saveTone === 'success' && styles.success, saveTone === 'error' && styles.error]}>
                {saveMessage}
              </Text>
            ) : null}
          </View>
        </View>

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
            ref={displayNameRef}
            accessibilityLabel="Display name"
            autoCapitalize="words"
            autoComplete="nickname"
            maxLength={24}
            editable={!profile.player.public_identity_hidden}
            onChangeText={(value) => { setDisplayName(value); setDisplayNameError(null); if (saveTone === 'error') { setSaveTone(null); setSaveMessage(null); } }}
            placeholder="Display name"
            placeholderTextColor={colors.faint}
            style={styles.input}
            value={displayName}
          />
          <Text style={styles.help}>Shown on Daily leaderboards and your public profile.</Text>
          {displayNameError ? <Text accessibilityRole="alert" style={styles.fieldError}>{displayNameError}</Text> : null}

          {!profile.player.public_identity_hidden ? (
            <View style={styles.termsBox}>
              <Text style={styles.help}>Display names and public profiles follow the Pack One Public Identity rules.</Text>
              <Pressable accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync('https://packone.pro/terms/#public-identity-rules')}>
                <Text style={styles.link}>Public Identity rules</Text>
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
              <Text style={styles.help}>Let players view your Pack One record from leaderboards and shared links.</Text>
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

          {enrichmentWarning ? <Text accessibilityRole="alert" style={styles.help}>{enrichmentWarning}</Text> : null}

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
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.6 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  editorHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  editorHeadingCopy: { flexGrow: 1, flexShrink: 1, minWidth: 220, gap: spacing.xs },
  editorActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, maxWidth: '100%' },
  secondaryCompactButton: { minHeight: 44, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primaryCompactButton: { minHeight: 44, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  saveStatus: { width: '100%', color: colors.muted, fontSize: 13, lineHeight: 19, fontWeight: '700', textAlign: 'right' },
  success: { color: colors.accentDark },
  error: { color: colors.danger },
  fieldError: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
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
