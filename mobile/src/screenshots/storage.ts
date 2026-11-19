import { Platform, Settings } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { config } from '@/src/config';

// Unsigned iOS simulators have no Keychain entitlement. These public, synthetic
// fixture values can use simulator preferences; production credentials never do.
function fixtureKey(key: string) {
  if (!config.screenshots.fixtures) throw new Error('Preview fixture storage is disabled.');
  return `packone-fixture-${key}`;
}
export async function getItemAsync(key: string): Promise<string | null> {
  const name = fixtureKey(key);
  return Platform.OS === 'ios' ? Settings.get(name) || null : SecureStore.getItemAsync(name);
}
export async function setItemAsync(key: string, value: string) {
  const name = fixtureKey(key);
  if (Platform.OS === 'ios') Settings.set({ [name]: value });
  else await SecureStore.setItemAsync(name, value);
}
export async function deleteItemAsync(key: string) {
  const name = fixtureKey(key);
  if (Platform.OS === 'ios') Settings.set({ [name]: '' });
  else await SecureStore.deleteItemAsync(name);
}
