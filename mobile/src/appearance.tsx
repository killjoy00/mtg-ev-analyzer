import { createElement, useSyncExternalStore, type ComponentType } from 'react';
import { Appearance } from 'react-native';

// Match the existing Pack One light palette. The app follows iOS/Android
// appearance settings, without adding a competing in-app theme control.
export const darkColors = Object.freeze({
  page: '#111923',
  surface: '#1b2835',
  surfaceSoft: '#263645',
  ink: '#f5f7fa',
  muted: '#c0cbd6',
  faint: '#acbbc9',
  line: '#35485a',
  lineStrong: '#6f8296',
  accent: '#28658e',
  accentDark: '#a2d4ff',
  accentSoft: '#29445b',
  danger: '#f1a59d',
});
type Token = keyof typeof darkColors;
const lightColors: Record<Token, string> = {
  page: '#f7f8fa', surface: '#ffffff', surfaceSoft: '#edf1f5',
  ink: '#101820', muted: '#5f6770', faint: '#626b74',
  line: '#d5dbe1', lineStrong: '#9ca5ac', accent: '#1e4d7a',
  accentDark: '#15395b', accentSoft: '#e5edf4', danger: '#934b42',
};

const appearanceMode = () => Appearance?.getColorScheme?.() === 'dark' ? 'dark' : 'light';
const readMode = () => appearanceMode();
const listen = (notify: () => void) => {
  const listener = Appearance?.addChangeListener?.(notify);
  return () => listener?.remove?.();
};
export function useAppTheme() {
  return useSyncExternalStore(listen, readMode, readMode);
}
export function themeColor(token: Token) {
  return appearanceMode() === 'dark' ? darkColors[token] : lightColors[token];
}

// Existing native screens use StyleSheet.create at module load. Recolor their
// semantic palette values lazily at render time, preserving their geometry,
// typesetting, image opacity, and touch targets. Style keys are cached.
const semanticDark = Object.fromEntries(
  (Object.keys(darkColors) as Token[]).map(key => [lightColors[key], darkColors[key]]),
) as Record<string, string>;
function darkValue(property: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.toLowerCase();
  const isColor = property === 'color' || /color$/i.test(property) || property === 'textDecorationColor';
  if (!isColor) return value;
  // Light text on filled brand buttons must remain light in dark mode.
  if (property === 'color' && (normalized === '#ffffff' || normalized === '#fff')) return '#ffffff';
  if (property === 'backgroundColor' && (normalized === '#fff' || normalized === '#ffffff')) return darkColors.surface;
  if (normalized === '#1e4d7a' && property !== 'backgroundColor') return '#a2d4ff';
  if (normalized === '#976822') return '#e1b574';
  if (normalized === '#8c4b36') return '#f0a98d';
  return semanticDark[normalized] ?? value;
}
export function themedStyles<T extends Record<string, object | number>>(sheet: T): T {
  const dark = new Map<string, object>();
  return new Proxy(sheet, {
    get(target, key, receiver) {
      const base = Reflect.get(target, key, receiver);
      if (typeof key !== 'string' || appearanceMode() !== 'dark' || !base || typeof base !== 'object') return base;
      let style = dark.get(key);
      if (!style) {
        style = Object.fromEntries(Object.entries(base).map(([property, value]) => [property, darkValue(property, value)]));
        dark.set(key, style);
      }
      return style;
    },
  });
}

// The route is not remounted when the OS appearance changes: active games,
// saved answers, scroll positions, and modal state are preserved.
export function withAppTheme<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  function ThemeAwareScreen(props: P) {
    useAppTheme();
    return createElement(Component, props);
  }
  ThemeAwareScreen.displayName = `ThemeAware(${Component.displayName || Component.name || 'Screen'})`;
  return ThemeAwareScreen;
}
