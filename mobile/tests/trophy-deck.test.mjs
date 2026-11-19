import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Shapes a real published trophy deck the way trophy-deck-dialog.mjs does:
// creature / other spell / land groups by mana value then name, a nonland
// curve of copies, color words, tags for the trophy and earlier picks, and
// only a canonical 17Lands draft link.
const require = createRequire(import.meta.url);
const { compileModule } = require('./support/compile-module.cjs');
const deckView = compileModule('src/trophyDeck.ts', {});
const { decodeTrophyDeckCatalog } = await import('../../worker/trophy-decks.mjs');
const { catalogLoaders } = await import('../../corpus/trophy-decks/index.mjs');

const catalog = decodeTrophyDeckCatalog((await catalogLoaders.fra()).encoded);
const raw = catalog.decks[0];
const expand = (rows) => rows.map(([card, count]) => ({ ...catalog.cards[card], count }));
const deck = { deck: expand(raw.deck), sideboard: expand(raw.sideboard), size: raw.size, event_type: raw.event_type,
  colors: raw.colors, splash_colors: raw.splash_colors, source: { name: '17Lands', url: '', license: 'CC BY 4.0', note: 'n', draft_url: raw.draft_url } };

test('a real deck keeps every copy in exactly one ordered group', () => {
  const trophyName = deck.deck.find((card) => !/Land/.test(card.type_line)).name;
  const groups = deckView.deckGroups(deck, { trophyName, priorNames: [deck.deck.at(-1).name] });
  assert.deepEqual(groups.map((group) => group.label), ['Creatures', 'Other spells', 'Lands'].filter((label) => groups.some((group) => group.label === label)));
  const total = deck.deck.reduce((sum, card) => sum + card.count, 0);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), total);
  for (const group of groups) {
    for (const [index, row] of group.rows.entries()) {
      assert.equal(deckView.deckGroup(row), group.label);
      const next = group.rows[index + 1];
      if (next) assert.ok(Number(row.mana_value) < Number(next.mana_value) || (Number(row.mana_value) === Number(next.mana_value) && row.name.localeCompare(next.name) <= 0));
    }
  }
  assert.equal(groups.flatMap((group) => group.rows).filter((row) => row.tag === 'Trophy pick').length, 1);
  const curve = deckView.deckCurve(deck);
  assert.equal(curve.length, 8);
  assert.equal(curve.reduce((sum, count) => sum + count, 0), deck.deck.filter((card) => deckView.deckGroup(card) !== 'Lands').reduce((sum, card) => sum + card.count, 0));
  assert.equal(deckView.deckDraftUrl(deck), raw.draft_url);
  assert.match(deckView.deckMeta(deck, '7–1'), /^7-1 · (Premier|Traditional) Draft · \d+ cards$/);
});

test('colors, mana symbols and links follow the web dialog rules', () => {
  assert.equal(deckView.deckColorText({ colors: 'UB', splash_colors: 'R' }), 'Blue and black, splashing red');
  assert.equal(deckView.deckColorText({ colors: '', splash_colors: '' }), '');
  assert.deepEqual(deckView.manaSymbols('{2}{W}{U/P}'), ['2', 'W', 'U/P']);
  assert.equal(deckView.deckDraftUrl({ source: { draft_url: 'https://evil.example/draft/' + 'a'.repeat(32) } }), null);
  assert.equal(deckView.deckMeta({ event_type: 'SomethingNew', size: 41 }), 'SomethingNew · 41 cards');
  assert.equal(deckView.sideboardCount({ sideboard: [{ count: 2 }, { count: 3 }] }), 5);
});
