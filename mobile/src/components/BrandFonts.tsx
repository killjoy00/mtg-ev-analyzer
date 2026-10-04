import { useFonts } from 'expo-font';
import { useEffect, type ReactNode } from 'react';
import { config } from '@/src/config';
import { FontsReady } from '@/src/components/Text';

export function BrandFonts({ children }: { children: ReactNode }) {
  const [loaded] = useFonts({
    'BarlowCondensed-Semibold': require('../../assets/fonts/BarlowCondensed-Semibold.ttf'),
    'BarlowCondensed-Bold': require('../../assets/fonts/BarlowCondensed-Bold.ttf'),
    'SourceSans3-Regular': require('../../assets/fonts/SourceSans3-Regular.ttf'),
    'SourceSans3-Semibold': require('../../assets/fonts/SourceSans3-Semibold.ttf'),
    'SourceSans3-Bold': require('../../assets/fonts/SourceSans3-Bold.ttf'),
  });
  useEffect(() => { if (loaded && config.screenshots.fixtures) console.info('PACKONE_FONTS', 'BarlowCondensed-Bold SourceSans3-Regular loaded'); }, [loaded]);
  // Bundled assets work offline; system text remains usable if a font cannot load.
  return <FontsReady.Provider value={loaded}>{children}</FontsReady.Provider>;
}
