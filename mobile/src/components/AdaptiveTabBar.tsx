import { useContext, useEffect, useRef, useState } from 'react';
import { BottomTabBar, BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { Keyboard, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { Text } from './Text';
import { config } from '@/src/config';
import { colors } from '@/src/theme';

/** Keep every destination readable when accessibility text outgrows five columns. */
export function AdaptiveTabBar(props: BottomTabBarProps) {
  const { width, height, fontScale } = useWindowDimensions();
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const enlarged = fontScale > 1.8;
  const shortWindow = height < 500;
  const available = width - props.insets.left - props.insets.right;
  const routes = props.state.routes.filter(route => props.descriptors[route.key] &&
    StyleSheet.flatten(props.descriptors[route.key]!.options.tabBarItemStyle)?.display !== 'none');
  const columns = Math.max(1, Math.min(routes.length, Math.max(2, Math.floor(available / (56 * fontScale)))));
  const itemWidth = shortWindow ? Math.max(180, 72 * fontScale) : available / columns;
  const selectedKey = props.state.routes[props.state.index]?.key;
  const selectedIndex = routes.findIndex(route => route.key === selectedKey);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (enlarged && keyboardVisible) reportHeight?.(0);
  }, [enlarged, keyboardVisible, reportHeight]);
  useEffect(() => {
    if (enlarged && shortWindow && selectedIndex >= 0)
      scroller.current?.scrollTo({ x: selectedIndex * itemWidth, animated: false });
  }, [enlarged, shortWindow, selectedIndex, itemWidth]);
  if (!enlarged) return <BottomTabBar {...props} />;
  if (keyboardVisible) return null;

  const items = routes.map(route => {
    const options = props.descriptors[route.key]!.options;
    const focused = route.key === selectedKey;
    const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? 'Pack One';
    const color = focused ? colors.accentDark : colors.muted;
    return <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={() => {
        const event = props.navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (!focused && !event.defaultPrevented) props.navigation.navigate(route.name, route.params);
      }}
      onLongPress={() => props.navigation.emit({ type: 'tabLongPress', target: route.key })}
      onLayout={event => recordTab('item', label, event)}
      style={[styles.item, { width: itemWidth, backgroundColor: focused ? colors.accentSoft : colors.surface }]}>
      {options.tabBarIcon?.({ focused, color, size: 24 })}
      <Text onLayout={event => recordTab('label', label, event)}
        onTextLayout={event => {
          if (config.screenshots.fixtures) console.info('PACKONE_TAB_LAYOUT', JSON.stringify({ kind: 'text', label,
            lines: event.nativeEvent.lines.map(line => ({ text: line.text, x: line.x, y: line.y, width: line.width, height: line.height })) }));
        }}
        style={[styles.label, { color }]}>{label}</Text>
    </Pressable>;
  });
  return <View onLayout={event => {
    reportHeight?.(event.nativeEvent.layout.height);
    if (config.screenshots.fixtures) console.info('PACKONE_TAB_LAYOUT', JSON.stringify({ kind: 'bar', label: 'navigation',
      labels: routes.map(route => props.descriptors[route.key]!.options.title), windowHeight: height, ...event.nativeEvent.layout }));
  }}
    style={[styles.bar, { paddingLeft: props.insets.left, paddingRight: props.insets.right, paddingBottom: Math.max(props.insets.bottom, 8) }]}>
    {shortWindow ? <ScrollView ref={scroller} horizontal style={styles.scroller}
      onContentSizeChange={() => scroller.current?.scrollTo({ x: Math.max(0, selectedIndex) * itemWidth, animated: false })}
      showsHorizontalScrollIndicator accessibilityHint="Swipe left or right for more destinations">
      {items}
    </ScrollView> : <View style={styles.grid}>{items}</View>}
  </View>;
}

function recordTab(kind: string, label: string, event: LayoutChangeEvent) {
  if (config.screenshots.fixtures) console.info('PACKONE_TAB_LAYOUT', JSON.stringify({ kind, label, ...event.nativeEvent.layout }));
}
const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  item: { minHeight: 64, paddingHorizontal: 8, paddingVertical: 8, gap: 4, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '600', textAlign: 'center', width: '100%', flexShrink: 1 },
  scroller: { flexGrow: 0, flexShrink: 0 },
});
