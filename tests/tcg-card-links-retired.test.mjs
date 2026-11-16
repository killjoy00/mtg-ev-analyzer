import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('website reveal and all published set archives contain no card storefront links', async () => {
  const reveal = await readFile(new URL('../draft-run-product.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(reveal, /run-card-shop|data-tcgplayer-card|tcgplayerUrl/, 'revealed cards stay display-only, with zoom still available');
  assert.match(reveal, /run-choice-image/, 'card zoom is preserved');
  for (const id of ['msh', 'sos', 'tmt', 'ecl']) {
    const html = await readFile(new URL(`../sets/${id}/index.html`, import.meta.url), 'utf8');
    assert.equal((html.match(/class="market-card"/g) || []).length, 5, `${id} keeps five top-card images`);
    assert.doesNotMatch(html, /data-tcgplayer-card|affiliate-note|class="market-card"[^>]*>[\\s\\S]*?<a /, `${id} has no card commerce actions`);
    assert.match(html, /class="market-grid"/);
  }
});
