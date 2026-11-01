import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {GUIDE_IDS,renderSetGuide} from '../set-guides.mjs';
import {escapeHtml as esc} from '../html.mjs';

const dataNotes=new Set(['ecl','tmt','sos','msh']);
for(const id of GUIDE_IDS) {
  const guide=JSON.parse(await readFile(`sets/guides/data/${id}.json`,'utf8'));
  if(guide.id!==id)throw new Error(`Guide id mismatch: ${id}`);
  const title=`${guide.name} draft guide · Pack One`;
  const description=`A quick ${guide.name} draft refresher: archetypes, format reminders, mechanics, and observed color results.`;
  const page=`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f7f8fa" />
  <meta name="description" content="${esc(description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="https://packone.pro/sets/${id}/guide/" />
  <meta property="og:image" content="https://packone.pro/mobile/assets/images/icon.png" />
  <link rel="canonical" href="https://packone.pro/sets/${id}/guide/" />
  <link rel="stylesheet" href="/visual-c.css?v=13" />
  <link rel="stylesheet" href="/editorial.css?v=9" />
  <link rel="stylesheet" href="/set-guides.css?v=4" data-set-guide-styles />
  <title>${esc(title)}</title>
</head>
<body data-page="editorial">
<header class="topbar">
  <a class="brand" href="/" aria-label="Return to Pack One home"><span class="brand-mark" aria-hidden="true"><span>P</span><sup>1</sup></span><span class="brand-copy"><strong>Pack One</strong></span></a>
  <div class="top-actions" aria-label="Primary" data-site-nav><a class="top-nav-button" href="/?game=draft-run&daily=1">Daily Run</a>
    <a class="top-nav-button" href="/practice/">Practice</a><a class="top-nav-button" href="/how-it-works/">How To Play</a><a class="top-nav-button" id="account-nav" href="/?account=1">Sign in</a></div>
</header>
<main class="editorial-main">
  <article class="set-guide-page">
    <nav class="guide-breadcrumb" aria-label="Guide navigation"><a href="/sets/">← All sets</a>${dataNotes.has(id)?`<a href="/sets/${id}/">${id.toUpperCase()} data notes</a>`:''}</nav>
    <header class="article-header"><p class="kicker">Set guide · ${esc(id==='powered-cube'?'Cube':id.toUpperCase())}</p><h1>${esc(guide.name)}</h1><p class="article-deck">A quick refresher before your next pick.</p></header>
    ${renderSetGuide(guide)}
    <aside class="article-cta"><p class="kicker">Put it into practice</p><h2>Ready for your next pick?</h2><a class="button-link" href="/?game=draft-run${id==='powered-cube'?'&amp;set=powered-cube':''}">${id==='powered-cube'?'Elite Cube Practice':'Play Draft Run'}</a></aside>
  </article>
</main>
<footer class="site-footer"><div><strong>Pack One</strong></div><nav aria-label="Footer"><a href="/about/">About</a><a href="/contact/">Contact</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></nav></footer>
<script src="/leaderboard-config.js"></script>
<script type="module" src="/site-nav.mjs?v=3"></script>
<script type="module" src="/sets/guide-page.mjs?v=1"></script>
</body>
</html>
`;
  await mkdir(`sets/${id}/guide`,{recursive:true});
  await writeFile(`sets/${id}/guide/index.html`,page);
}
console.log(`Built ${GUIDE_IDS.length} set guides.`);
const sitemapPath='sitemap.xml';
const sitemap=(await readFile(sitemapPath,'utf8')).replace(/^.*<loc>https:\/\/packone\.pro\/sets\/[^/]+\/guide\/<\/loc>.*\n/gm,'');
await writeFile(sitemapPath,sitemap.replace('</urlset>',GUIDE_IDS.map(id=>`  <url><loc>https://packone.pro/sets/${id}/guide/</loc></url>`).join('\n')+'\n</urlset>'));
