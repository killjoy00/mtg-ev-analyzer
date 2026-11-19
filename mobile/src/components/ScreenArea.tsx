import { useContext } from 'react';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { BottomTabBarHeightContext } from 'expo-router/tabs';

/** The navigator already consumes its header/tab insets. Modals and headerless
 * screens still own theirs. No screen gets the same safe area twice. */
export function ScreenArea(props: SafeAreaViewProps) {
  const header = useContext(HeaderHeightContext);
  const tabs = useContext(BottomTabBarHeightContext);
  return <SafeAreaView edges={['left', 'right', ...(!header ? ['top' as const] : []), ...(!tabs ? ['bottom' as const] : [])]} {...props} />;
}
