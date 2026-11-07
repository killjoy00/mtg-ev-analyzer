import type { TrophyDeck, TrophyDeckCard } from '@/src/api/draftRun';

// Mirrors deckMarkup in trophy-deck-dialog.mjs: the same groups, order, curve,
// colors, tags and source links, shaped for a native list.

const EVENTS: Record<string, string> = { PremierDraft: 'Premier Draft', TradDraft: 'Traditional Draft', PickTwoDraft: 'Pick Two Draft' };
const COLOR_NAMES: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const DRAFT_URL = /^https:\/\/www\.17lands\.com\/draft\/[a-f0-9]{32}$/;

export const DECK_SOURCE_URL = 'https://www.17lands.com/public_datasets';
export const DECK_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

export type DeckGroupLabel = 'Creatures' | 'Other spells' | 'Lands';
export type DeckRow = TrophyDeckCard & { tag: 'Trophy pick' | 'Earlier pick' | null };
export type DeckGroup = { label: DeckGroupLabel; count: number; rows: DeckRow[] };
export type DeckContext = { record?: string | null; trophyName?: string | null; priorNames?: string[] };

export function deckGroup(card: Pick<TrophyDeckCard, 'type_line'>): DeckGroupLabel {
  const type = String(card.type_line ?? '');
  return /\bLand\b/.test(type) ? 'Lands' : /\bCreature\b/.test(type) ? 'Creatures' : 'Other spells';
}

export function manaSymbols(cost: string | undefined) {
  return [...String(cost ?? '').matchAll(/\{([^}]+)\}/g)].map((match) => String(match[1]));
}

function colorWords(value: string | undefined) {
  return [...String(value ?? '')].map((c) => COLOR_NAMES[c]).filter(Boolean).join(' and ');
}

export function deckColorText(deck: Pick<TrophyDeck, 'colors' | 'splash_colors'>) {
  const text = colorWords(deck.colors) + (deck.splash_colors ? `, splashing ${colorWords(deck.splash_colors)}` : '');
  return text ? text[0]!.toUpperCase() + text.slice(1) : '';
}

// Nonland mana values 0 through 7+, counting copies.
export function deckCurve(deck: Pick<TrophyDeck, 'deck'>) {
  const curve = Array<number>(8).fill(0);
  for (const card of deck.deck) {
    if (deckGroup(card) === 'Lands') continue;
    const value = Math.min(7, Math.max(0, Math.floor(Number(card.mana_value) || 0)));
    curve[value] = (curve[value] ?? 0) + card.count;
  }
  return curve;
}

export function deckGroups(deck: Pick<TrophyDeck, 'deck'>, context: DeckContext = {}): DeckGroup[] {
  const earlier = new Set(context.priorNames ?? []);
  return (['Creatures', 'Other spells', 'Lands'] as const).flatMap((label) => {
    const cards = deck.deck.filter((card) => deckGroup(card) === label)
      .sort((a, b) => Number(a.mana_value) - Number(b.mana_value) || a.name.localeCompare(b.name));
    if (!cards.length) return [];
    return [{
      label,
      count: cards.reduce((sum, card) => sum + card.count, 0),
      rows: cards.map((card) => ({
        ...card,
        tag: card.name === context.trophyName ? 'Trophy pick' as const : earlier.has(card.name) ? 'Earlier pick' as const : null,
      })),
    }];
  });
}

export function deckMeta(deck: Pick<TrophyDeck, 'event_type' | 'size'>, record?: string | null) {
  return `${record ? `${record.replace('–', '-')} · ` : ''}${EVENTS[deck.event_type] ?? deck.event_type} · ${deck.size} cards`;
}

export function deckDraftUrl(deck: Pick<TrophyDeck, 'source'>) {
  const url = deck.source?.draft_url;
  return url && DRAFT_URL.test(url) ? url : null;
}

export function sideboardCount(deck: Pick<TrophyDeck, 'sideboard'>) {
  return deck.sideboard.reduce((sum, card) => sum + card.count, 0);
}
