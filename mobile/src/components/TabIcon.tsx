import { Image, type ColorValue } from 'react-native';
import { config } from '@/src/config';
import { tabIconAssets } from './tabIconAssets';

export function TabIcon({ name, color }: { name: keyof typeof tabIconAssets; color: ColorValue }) {
  return <Image accessible={false} source={{ uri: tabIconAssets[name] }}
    resizeMode="contain" style={{ width: 24, height: 24, tintColor: color }}
    onLoad={() => { if (config.screenshots.fixtures) console.info('PACKONE_TAB_ICON', JSON.stringify({ name })); }} />;
}
