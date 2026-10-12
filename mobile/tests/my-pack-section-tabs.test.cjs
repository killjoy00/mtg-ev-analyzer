const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const Renderer = require('react-test-renderer');
const { compileModule } = require('./support/compile-module.cjs');
const { act } = Renderer;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const host = name => function Host(props) { return React.createElement(name, props, props.children); };
const flat = value => Object.assign({}, ...(Array.isArray(value) ? value : [value]).filter(Boolean));

function fixture() {
  let dimensions = { width: 390, height: 844, fontScale: 1 };
  const destinations = [];
  const mocks = {
    'expo-router': { router: {
      push: destination => destinations.push(['push', destination]),
      dismissTo: destination => destinations.push(['dismiss', destination]),
    } },
    'react-native': {
      Pressable: host('Pressable'), View: host('View'),
      StyleSheet: { create: rules => rules }, useWindowDimensions: () => dimensions,
    },
    '@/src/components/Text': { Text: host('Text') },
    '@/src/theme': { colors: {
      accent: '#008', accentSoft: '#eef', ink: '#123', muted: '#456', line: '#ccc',
    }, spacing: { sm: 8, md: 16 } },
  };
  const Component = compileModule('src/components/MyPackSectionTabs.tsx', mocks).MyPackSectionTabs;
  let root;
  const tabs = () => root.root.findAllByType('Pressable');
  const tab = label => tabs().find(node => node.props.accessibilityLabel === label);
  return {
    destinations,
    tabs, tab,
    nav: () => root.root.findByType('View'),
    setDimensions: value => { dimensions = value; },
    async show(active) {
      await act(async () => {
        if (root) root.update(React.createElement(Component, { active }));
        else root = Renderer.create(React.createElement(Component, { active }));
      });
    },
    async close() { if (root) await act(async () => root.unmount()); },
  };
}

test('My Pack One keeps three accessible, selectable tabs with ordinary text', async () => {
  const ui = fixture();
  try {
    await ui.show('stats');
    assert.equal(flat(ui.nav().props.style).flexDirection, 'row');
    assert.deepEqual(ui.tabs().map(tab => tab.props.accessibilityLabel),
      ['Stats', 'Insights', 'Account settings']);
    assert.deepEqual(ui.tabs().map(tab => tab.props.accessibilityState.selected),
      [true, false, false]);
    for (const tab of ui.tabs()) {
      assert.equal(tab.props.accessibilityRole, 'tab');
      assert.ok(flat(tab.props.style).minHeight >= 44);
      assert.equal(tab.findByType('Text').props.numberOfLines, undefined);
      assert.equal(tab.findByType('Text').props.allowFontScaling, undefined,
        'Do not cap system text scaling');
    }
    await act(async () => ui.tab('Insights').props.onPress());
    await act(async () => ui.tab('Account settings').props.onPress());
    assert.deepEqual(ui.destinations, [['push', '/insights'], ['push', '/account']]);
  } finally { await ui.close(); }
});

test('accessibility Dynamic Type reflows into full-width, growing rows on iPhone', async () => {
  const ui = fixture();
  try {
    ui.setDimensions({ width: 440, height: 956, fontScale: 3.571 });
    await ui.show('insights');
    assert.equal(flat(ui.nav().props.style).flexDirection, 'column');
    for (const tab of ui.tabs()) {
      const style = flat(tab.props.style);
      assert.equal(style.width, '100%', tab.props.accessibilityLabel);
      assert.equal(style.flex, 0);
      assert.ok(style.minHeight >= 48);
      assert.ok(style.paddingVertical > 0, 'Scaled labels must grow vertically');
      assert.equal(tab.findByType('Text').props.numberOfLines, undefined);
    }
    assert.deepEqual(ui.tabs().map(tab => tab.props.accessibilityState.selected),
      [false, true, false]);
    const selected = flat(ui.tab('Insights').props.style);
    assert.equal(selected.borderLeftWidth, 3, 'Selection remains visible in a vertical list');
    await act(async () => ui.tab('Stats').props.onPress());
    await act(async () => ui.tab('Account settings').props.onPress());
    assert.deepEqual(ui.destinations, [['dismiss', '/career'], ['push', '/account']]);

    ui.setDimensions({ width: 320, height: 740, fontScale: 1.7 });
    await ui.show('insights');
    assert.equal(flat(ui.nav().props.style).flexDirection, 'column');

    ui.setDimensions({ width: 1024, height: 768, fontScale: 1.5 });
    await ui.show('insights');
    assert.equal(flat(ui.nav().props.style).flexDirection, 'row',
      'A wide tablet retains the horizontal tabs');
    ui.setDimensions({ width: 440, height: 956, fontScale: 1 });
    await ui.show('insights');
    assert.equal(flat(ui.nav().props.style).flexDirection, 'row',
      'Returning to normal text restores the original navigation layout');
  } finally { await ui.close(); }
});
