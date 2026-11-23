'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Scope: every native route, screen, and visual component. A new .tsx file is
// picked up automatically; this is not a manually maintained screen whitelist.
const roots = ['app', 'src/screens', 'src/components'];
const files = roots.flatMap(root => {
  const walk = folder => fs.readdirSync(folder, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory()
      ? walk(path.join(folder, entry.name))
      : entry.name.endsWith('.tsx') ? [path.join(folder, entry.name)] : []);
  return walk(root);
}).sort();
const read = file => fs.readFileSync(file, 'utf8');
const route = file => file.startsWith('app' + path.sep) || file.startsWith('src' + path.sep + 'screens' + path.sep);
const viewer = path.join('src', 'components', 'CardFaceViewer.tsx');

test('all native screens with stylesheets use theme-reactive styles and a theme subscription', () => {
  let styled = 0;
  for (const file of files) {
    const source = read(file);
    if (!/\bStyleSheet\.create\s*\(/.test(source)) continue;
    if (file === viewer) continue; // Intentionally fixed dark, with white Close controls.
    styled += 1;
    assert.match(source, /\bthemedStyles\s*\(\s*StyleSheet\.create\s*\(/,
      file + ': new stylesheets need system dark/light mapping');
    if (route(file)) {
      assert.match(source, /\bwithAppTheme\b|\buseAppTheme\s*\(/,
        file + ': new screens must rerender when the OS appearance changes');
    }
  }
  assert.ok(styled >= 20, 'expected existing native screens to be checked');
});

test('inline native color props and JSX styles cannot bypass the semantic theme', () => {
  const visualProps = new Set([
    'color', 'placeholderTextColor', 'selectionColor', 'tintColor',
    'backgroundColor', 'borderColor', 'thumbColor', 'trackColor',
    'fill', 'stroke', 'style', 'contentContainerStyle', 'imageStyle',
  ]);
  let visited = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function walk(node) {
      if (ts.isJsxAttribute(node) && visualProps.has(node.name.text) &&
          node.initializer && ts.isJsxExpression(node.initializer)) {
        function inspect(child) {
          if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) &&
              child.expression.text === 'colors') {
            const pos = source.getLineAndCharacterOfPosition(child.getStart(source));
            assert.fail(file + ':' + (pos.line + 1) + ': JSX visual colors must use themeColor(token) or themedStyles');
          }
          ts.forEachChild(child, inspect);
        }
        if (node.initializer.expression) inspect(node.initializer.expression);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    visited++;
  }
  assert.ok(visited >= 40, 'all native screens/components must be included');
});

// Parse the source palette once, and reject unregistered hex literals in any
// native JSX module (including inline styles, constants and new components).
// Registered raw #fff text on dark button fills is intentional. Role colors
// must have an explicit light/dark pair, not a one-theme hard-coded value.
const hexLiteral = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function normalizeHex(raw) {
  const hex = raw.toLowerCase();
  return hex.length === 4 ? '#' + [...hex.slice(1)].map(ch => ch + ch).join('') : hex;
}
function palette(source, marker) {
  const startMarker = source.indexOf(marker);
  assert.ok(startMarker >= 0, 'missing color palette: ' + marker);
  const start = source.indexOf('{', startMarker);
  let depth = 1;
  let end = start + 1;
  while (depth > 0 && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, 'unterminated palette ' + marker);
  return Object.fromEntries([...source.slice(start + 1, end - 1)
    .matchAll(/\b([a-zA-Z]\w*):\s*'(#[0-9a-fA-F]{3,8})'/g)]
    .map(match => [match[1], normalizeHex(match[2])]));
}
const light = palette(read('src/theme.ts'), 'export const colors = Object.freeze(');
const dark = palette(read('src/appearance.ts'), 'export const darkColors = Object.freeze(');
const appearanceLight = palette(read('src/appearance.ts'), 'const lightColors: Record<Token, string> = ');
const registeredColors = new Set(Object.values(light));
function unfamiliarColors(source, file) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const errors = [];
  function walk(node) {
    if (ts.isStringLiteralLike(node) && hexLiteral.test(node.text) &&
        !registeredColors.has(normalizeHex(node.text))) {
      const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
      errors.push(file + ':' + (line + 1) + ': ' + node.text);
    }
    ts.forEachChild(node, walk);
  }
  walk(parsed);
  return errors;
}

test('native dark-mode visual colors have registered light and dark palette partners', () => {
  assert.ok(Object.keys(light).length >= 20, 'shared palette was not loaded');
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort(),
    'every native color must have a dark mode equivalent');
  assert.deepEqual(appearanceLight, light, 'static theme and appearance light palette must stay in sync');
  assert.deepEqual(
    unfamiliarColors("const styles = StyleSheet.create({ label: { color: '#123abc' } });", 'bad.tsx'),
    ['bad.tsx:1: #123abc'], 'a new unregistered hard-coded style color must fail');
  assert.deepEqual(unfamiliarColors("const color = '#fff';", 'good.tsx'), [],
    'normalized shorthand palette colors are known');
  const errors = files.flatMap(file => unfamiliarColors(read(file), file));
  assert.deepEqual(errors, [], 'use a semantic color in src/theme.ts with a dark partner in src/appearance.ts');
});

function luminance(raw) {
  const hex = normalizeHex(raw).slice(1);
  const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('revealed pick labels and trophy-deck sheet text meet 4.5:1 in light and dark', () => {
  const draft = read('app/draft-run.tsx');
  const deck = read('src/components/TrophyDeckSheet.tsx');
  for (const [role, token] of [
    ['choiceLabelMine', 'revealMineText'],
    ['choiceLabelTrophy', 'revealTrophyText'],
    ['choiceLabelMatch', 'revealMatchText'],
  ]) {
    assert.match(draft, new RegExp(role + ': \\{ color: colors\\.' + token + ' \\}'),
      role + ' must use the verified contrast token');
  }
  assert.match(deck, /trophyRow: \{ backgroundColor: colors\.trophyRow, borderColor: colors\.trophyRowBorder/);
  assert.match(deck, /cardName: \{ color: colors\.accentDark/);
  assert.match(deck, /trophyTag: \{ color: colors\.revealMineText/);
  for (const [mode, tokens] of [['light', light], ['dark', dark]]) {
    for (const label of ['revealMineText', 'revealTrophyText', 'revealMatchText']) {
      for (const background of ['surface', 'surfaceSoft']) {
        assert.ok(contrast(tokens[label], tokens[background]) >= 4.5,
          mode + ' ' + label + ' on ' + background + ' must be readable');
      }
    }
    for (const text of ['accentDark', 'revealMineText']) {
      assert.ok(contrast(tokens[text], tokens.trophyRow) >= 4.5,
        mode + ' trophy deck ' + text + ' on highlighted row must be readable');
    }
    for (const mana of ['manaWhite', 'manaBlue', 'manaBlack', 'manaRed', 'manaGreen', 'manaFallback']) {
      assert.equal(dark[mana], light[mana], 'mana symbols intentionally keep their color: ' + mana);
      assert.ok(contrast(tokens.manaInk, tokens[mana]) >= 4.5,
        'mana glyph on fixed light symbol must stay legible in ' + mode);
    }
  }
});

test('enlarged viewer deliberately remains dark and the Close action stays visible', () => {
  const source = read(viewer);
  assert.match(source, /const styles = StyleSheet\.create\(/,
    'viewer is exempt from automatic recoloring');
  assert.doesNotMatch(source, /themedStyles\s*\(/);
  assert.match(source, /backgroundColor: 'rgba\(10,20,14,0\.96\)'/);
  assert.match(source, /closeButton: \{ minHeight: 48, minWidth: 82, backgroundColor: colors\.surface/);
  assert.match(source, /buttonText: \{ color: colors\.ink/);
  assert.match(source, /testID="card-viewer-header"/);
});
