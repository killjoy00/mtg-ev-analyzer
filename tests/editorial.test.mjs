import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = ['index.html','how-it-works/index.html','scoring/index.html','methodology/index.html','learn/index.html','learn/first-pick-discipline/index.html','learn/reading-consensus/index.html','learn/staying-open/index.html','sets/index.html','sets/msh/index.html','sets/sos/index.html','sets/tmt/index.html','sets/ecl/index.html','about/index.html','contact/index.html','privacy/index.html','terms/index.html','disclosure/index.html'];
for (const path of pages) {
  const html = await readFile(path, 'utf8');
  assert.match(html, /<meta name="description"/i, `${path} needs a description`);
  assert.match(html, /rel="canonical"/i, `${path} needs a canonical`);
  assert.doesNotMatch(html, /lorem ipsum/i, `${path} must not contain filler`);
}
for (const path of ['how-it-works/index.html','scoring/index.html','methodology/index.html','learn/first-pick-discipline/index.html','learn/reading-consensus/index.html','learn/staying-open/index.html','sets/msh/index.html']) {
  const html = await readFile(path, 'utf8');
  const words = html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 330, `${path} is too thin for the editorial shell: ${words} words`);
}
const home = await readFile('index.html','utf8');
assert.match(home, /id="home-editorial"/);
assert.match(home, /data-ad-slot="home"/);
assert.match(home, /href="\/learn\/"/);
assert.match(home, /<meta name='impact-site-verification' value='90785cbe-56bd-41a8-8282-59967ea86f97'>/);
const ads = await readFile('ad-config.js','utf8');
assert.match(ads, /enabled:\s*false/);
const tcg = await readFile('tcgplayer.mjs','utf8');
assert.match(tcg, /rel = 'sponsored noopener'/);
assert.match(tcg, /tcgplayer_click/);
const disclosure = await readFile('disclosure/index.html','utf8');
assert.match(disclosure, /Impact/i);
assert.match(disclosure, /commission/i);
const sitemap = await readFile('sitemap.xml','utf8');
assert.match(sitemap, /\/sets\/msh\//);
assert.match(sitemap, /\/learn\/first-pick-discipline\//);
console.log('Editorial and monetization shell guardrails passed.');
