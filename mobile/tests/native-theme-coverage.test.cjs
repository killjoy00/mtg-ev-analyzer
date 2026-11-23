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
