import { createContext, useContext } from 'react';
import { Text as NativeText, StyleSheet, type TextProps } from 'react-native';

export const FontsReady = createContext(false);

/** Explicit static faces avoid synthetic weights and keep OS text scaling enabled. */
export function Text({ style, ...props }: TextProps) {
  const ready = useContext(FontsReady);
  const flat = StyleSheet.flatten(style) || {};
  const weight = Number(flat.fontWeight) || (flat.fontWeight === 'bold' ? 700 : 400);
  const display = Number(flat.fontSize) >= 20;
  const fontFamily = display
    ? weight >= 700 ? 'BarlowCondensed-Bold' : 'BarlowCondensed-Semibold'
    : weight >= 700 ? 'SourceSans3-Bold' : weight >= 500 ? 'SourceSans3-Semibold' : 'SourceSans3-Regular';
  return <NativeText {...props} style={[style, ready && { fontFamily, fontWeight: 'normal' }]} />;
}
