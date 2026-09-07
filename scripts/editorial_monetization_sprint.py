from __future__ import annotations

import json
import math
from collections import Counter
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://magic.planitnow.us"
SETS = ["msh", "sos", "tmt", "ecl"]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


def analyze_set(set_id: str) -> dict:
    manifest = json.loads((ROOT / f"data/{set_id}/manifest.json").read_text(encoding="utf-8"))
    opening = []
    images = {}
    for shard_meta in manifest.get("shards", []):
        shard = json.loads((ROOT / shard_meta["path"].removeprefix("./")).read_text(encoding="utf-8"))
        for replay in shard.get("replays", []):
            pick = next((p for p in replay.get("picks", []) if p.get("pack_number") == 1 and p.get("pick_number") == 1), None)
            if not pick:
                continue
            ranked = sorted(pick.get("candidates", []), key=lambda c: float(c.get("model_probability", 0)), reverse=True)
            if len(ranked) < 2:
                continue
            for card in ranked:
                if card.get("name") and card.get("image_url"):
                    images.setdefault(card["name"], card["image_url"])
            p1 = float(ranked[0].get("model_probability", 0))
            p2 = float(ranked[1].get("model_probability", 0))
            opening.append({
                "top": ranked[0]["name"],
                "second": ranked[1]["name"],
                "p1": p1,
                "p2": p2,
                "margin": p1 - p2,
                "historical_match": pick.get("historical_pick_id") == pick.get("consensus_pick_id"),
                "candidates": len(ranked),
            })
    if not opening:
        raise RuntimeError(f"No opening-pick data found for {set_id}")
    top_counts = Counter(row["top"] for row in opening)
    most_common = top_counts.most_common(5)
    toughest = sorted(opening, key=lambda row: row["margin"])[:3]
    clear = sum(row["margin"] >= .30 for row in opening)
    close = sum(row["margin"] <= .10 for row in opening)
    agreement = sum(row["historical_match"] for row in opening)
    n = len(opening)
    cohort = manifest.get("cohort", {})
    return {
        "id": set_id,
        "name": manifest.get("name", set_id.upper()),
        "date": manifest.get("source", {}).get("data_date", ""),
        "replays": manifest.get("replay_count", n),
        "training_drafts": int(cohort.get("training_drafts", 0)),
        "training_picks": int(cohort.get("training_picks", 0)),
        "experienced_drafts": int(cohort.get("experienced_drafts", 0)),
        "cutoff": float(cohort.get("win_rate_cutoff", 0)),
        "avg_top": sum(row["p1"] for row in opening) / n,
        "avg_margin": sum(row["margin"] for row in opening) / n,
        "avg_candidates": sum(row["candidates"] for row in opening) / n,
        "close_pct": close / n,
        "clear_pct": clear / n,
        "historical_agreement": agreement / n,
        "top_cards": [{"name": name, "count": count, "image": images.get(name, "")} for name, count in most_common],
        "toughest": toughest,
    }


set_stats = [analyze_set(set_id) for set_id in SETS]


def head(title: str, description: str, path: str) -> str:
    canonical = f"{ORIGIN}{path}"
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f7f7f5" />
  <meta name="description" content="{escape(description, quote=True)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="{escape(title, quote=True)}" />
  <meta property="og:description" content="{escape(description, quote=True)}" />
  <meta property="og:url" content="{canonical}" />
  <link rel="canonical" href="{canonical}" />
  <link rel="stylesheet" href="/editorial.css?v=1" />
  <title>{escape(title)}</title>
</head>
<body data-page="editorial">
<header class="site-header">
  <a class="site-brand" href="/"><span>P1</span><strong>Pack One</strong></a>
  <nav aria-label="Primary">
    <a href="/">Play</a>
    <a href="/learn/">Learn</a>
    <a href="/scoring/">Scoring</a>
    <a href="/methodology/">Method</a>
    <a href="/sets/">Sets</a>
  </nav>
</header>'''


def footer() -> str:
    return '''<footer class="site-footer">
  <div><strong>Pack One</strong><p>An independent Limited draft game built from public 17Lands draft data.</p></div>
  <nav aria-label="Footer"><a href="/about/">About</a><a href="/contact/">Contact</a><a href="/disclosure/">Disclosure</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></nav>
</footer>
<script src="/ad-config.js"></script>
<script src="/tcgplayer-config.js"></script>
<script type="module" src="/ads.mjs"></script>
<script type="module" src="/tcgplayer.mjs"></script>
</body>
</html>'''


def ad(slot: str, size: str = "wide") -> str:
    return f'<aside class="ad-slot ad-slot-{size}" data-ad-slot="{slot}" aria-label="Advertisement"><span>Advertisement</span></aside>'


def article_page(title: str, deck: str, path: str, body: str, kicker: str = "Pack One guide") -> str:
    return head(title, deck, path) + f'''
<main class="editorial-main">
  <article class="article-shell">
    <header class="article-header"><p class="kicker">{escape(kicker)}</p><h1>{escape(title)}</h1><p class="article-deck">{escape(deck)}</p></header>
    {ad('article-top')}
    <div class="prose">{body}</div>
    <aside class="article-cta"><p class="kicker">Put it into practice</p><h2>Make the decision before you read the answer.</h2><p>Pack One is most useful when you commit first, then use the consensus as a comparison point—not an instruction sheet.</p><a class="button-link" href="/">Play Pack One</a></aside>
  </article>
</main>
''' + footer()


editorial_css = r'''
:root{--page:#f7f7f5;--surface:#fff;--soft:#eef1ed;--ink:#171918;--muted:#626965;--line:#d9ddd9;--green:#2f654a;--green-dark:#234d39;--gold:#946824;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--content:1120px}*{box-sizing:border-box}html{background:var(--page)}body{margin:0;background:var(--page);color:var(--ink);font-family:var(--sans);line-height:1.65;-webkit-font-smoothing:antialiased}a{color:inherit}.site-header{min-height:68px;padding:12px max(20px,calc((100vw - var(--content))/2));display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid var(--line);background:rgba(247,247,245,.97);position:sticky;top:0;z-index:10}.site-brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none}.site-brand span{width:38px;height:38px;display:grid;place-items:center;border-radius:9px;background:var(--ink);color:white;font-size:11px;font-weight:850}.site-brand strong{font-size:16px;letter-spacing:-.02em}.site-header nav,.site-footer nav{display:flex;gap:18px;flex-wrap:wrap}.site-header nav a,.site-footer a{color:var(--muted);font-size:12px;font-weight:700;text-decoration:none}.site-header nav a:hover,.site-footer a:hover{color:var(--ink)}.editorial-main{width:min(var(--content),100%);margin:0 auto;padding:64px 24px 90px}.article-shell{max-width:860px;margin:0 auto}.article-header{max-width:780px;margin-bottom:34px}.kicker{margin:0 0 10px;color:var(--green);font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.1em}.article-header h1,.landing-hero h1{margin:0 0 18px;font-size:clamp(42px,6vw,68px);line-height:.98;letter-spacing:-.05em}.article-deck,.landing-hero .deck{margin:0;color:var(--muted);font-size:clamp(17px,2vw,21px);line-height:1.6}.prose{font-size:17px}.prose h2{margin:48px 0 12px;font-size:29px;line-height:1.15;letter-spacing:-.03em}.prose h3{margin:30px 0 8px;font-size:19px}.prose p{margin:0 0 20px}.prose ul{padding-left:22px}.prose li{margin:8px 0}.prose strong{font-weight:780}.callout{margin:30px 0;padding:22px 24px;border-left:4px solid var(--green);background:var(--soft)}.article-cta{margin-top:56px;padding:32px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.article-cta h2{margin:0 0 10px;font-size:27px;line-height:1.15}.article-cta p:not(.kicker){color:var(--muted)}.button-link{display:inline-flex;min-height:44px;align-items:center;padding:10px 16px;border-radius:8px;background:var(--green);color:white;text-decoration:none;font-weight:780}.button-link:hover{background:var(--green-dark)}.ad-slot{margin:34px 0;display:grid;place-items:center;border:1px dashed #c8cdc9;border-radius:10px;background:#f1f2f0;overflow:hidden;color:#919691;text-transform:uppercase;font-size:9px;letter-spacing:.12em}.ad-slot-wide{min-height:120px}.ad-slot-inline{min-height:250px}.ad-slot>span{padding:10px}.ad-preview-creative{width:100%;min-height:inherit;padding:26px 34px;display:flex;align-items:center;justify-content:space-between;gap:24px;background:linear-gradient(120deg,#1c2821,#304a39);color:#fff;text-transform:none;letter-spacing:0}.ad-preview-creative div{max-width:580px}.ad-preview-creative small{display:block;margin-bottom:6px;opacity:.7;text-transform:uppercase;letter-spacing:.1em}.ad-preview-creative strong{display:block;font-size:22px;line-height:1.1}.ad-preview-creative p{margin:7px 0 0;opacity:.84}.ad-preview-creative b{padding:9px 13px;border-radius:7px;background:#fff;color:#1c2821;white-space:nowrap;font-size:12px}.site-footer{width:min(var(--content),100%);margin:0 auto;padding:34px 24px 46px;display:flex;justify-content:space-between;gap:30px;border-top:1px solid var(--line)}.site-footer p{max-width:560px;margin:4px 0 0;color:var(--muted);font-size:12px}.landing-hero{max-width:900px;margin-bottom:44px}.landing-grid,.set-grid,.guide-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.content-card{padding:26px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.content-card h2,.content-card h3{margin:0 0 8px;letter-spacing:-.025em}.content-card p{margin:0;color:var(--muted)}.content-card a{display:inline-block;margin-top:16px;color:var(--green-dark);font-weight:780;text-underline-offset:3px}.set-metrics{margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.set-metrics div{padding:10px;border-radius:8px;background:var(--soft)}.set-metrics strong{display:block;font-size:18px}.set-metrics span{display:block;color:var(--muted);font-size:10px}.market-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:24px 0}.market-card{min-width:0}.market-card img{width:100%;aspect-ratio:63/88;object-fit:cover;border-radius:8px;background:#ddd}.market-card strong{display:block;margin-top:7px;font-size:12px;line-height:1.3}.market-card a{color:var(--green-dark);font-size:11px;font-weight:750}.affiliate-note{margin:18px 0;padding:14px 16px;border:1px solid #d9cfb9;border-radius:10px;background:#faf6eb;color:#6e5a33;font-size:12px}.table-wrap{overflow:auto}.data-table{width:100%;border-collapse:collapse;margin:20px 0}.data-table th,.data-table td{padding:11px 10px;border-bottom:1px solid var(--line);text-align:left;font-size:13px}.data-table th{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.home-editorial{width:min(var(--content),100%);margin:0 auto;padding:12px 24px 72px}.home-editorial .editorial-rule{margin:10px 0 36px;border:0;border-top:1px solid var(--line)}.home-editorial-head{max-width:800px}.home-editorial-head h2{margin:0 0 12px;font-size:34px;line-height:1.1;letter-spacing:-.035em}.home-editorial-head p{color:var(--muted);font-size:16px}.home-editorial .guide-grid{margin-top:24px}.home-editorial .content-card h3{font-size:17px}.is-game .home-editorial{display:none}.market-link{display:inline-block;margin-left:8px;color:var(--green-dark);font-size:10px;font-weight:750;text-decoration:underline;text-underline-offset:2px}.rank-row .market-link{margin-left:auto}.feedback-grid .market-link{margin-left:0}.affiliate-mini{margin:14px 0 0;color:var(--muted);font-size:10px}@media(max-width:760px){.site-header{align-items:flex-start;flex-direction:column;gap:9px}.site-header nav{gap:12px}.editorial-main{padding:44px 18px 68px}.landing-grid,.set-grid,.guide-grid{grid-template-columns:1fr}.market-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.site-footer{flex-direction:column}.ad-preview-creative{align-items:flex-start;flex-direction:column}.set-metrics{grid-template-columns:1fr 1fr}.home-editorial{padding-left:18px;padding-right:18px}}
'''
write("editorial.css", editorial_css)

write("tcgplayer-config.js", '''// Public configuration only. Do not put API secrets here.
window.PACKONE_TCGPLAYER = Object.freeze({
  program: 'Impact',
  // After TCGplayer/Impact approval, paste the deep-link template supplied by Impact.
  // It must contain {url}; Pack One will insert the encoded TCGplayer destination.
  impactDeepLinkTemplate: '',
  disclosure: 'Pack One may earn a commission from eligible purchases made through TCGplayer links.'
});
''')

write("tcgplayer.mjs", '''import { sendEvents } from './growth-api.mjs';

const SEARCH_BASE = 'https://www.tcgplayer.com/search/magic/product';

function config() { return globalThis.PACKONE_TCGPLAYER || {}; }

export function tcgplayerDestination(cardName) {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set('q', String(cardName || '').trim());
  url.searchParams.set('view', 'grid');
  return url.toString();
}

export function tcgplayerUrl(cardName) {
  const destination = tcgplayerDestination(cardName);
  const template = String(config().impactDeepLinkTemplate || '').trim();
  if (template && template.includes('{url}')) return template.replace('{url}', encodeURIComponent(destination));
  return destination;
}

export function tcgplayerAffiliateActive() {
  const template = String(config().impactDeepLinkTemplate || '').trim();
  return Boolean(template && template.includes('{url}'));
}

function decorateStaticLinks() {
  document.querySelectorAll('[data-tcgplayer-card]').forEach((link) => {
    const card = link.getAttribute('data-tcgplayer-card');
    if (!card) return;
    link.href = tcgplayerUrl(card);
    link.target = '_blank';
    link.rel = 'sponsored noopener';
    link.dataset.tcgplayerLink = '1';
  });
}

function trackClick(event) {
  const link = event.target.closest?.('[data-tcgplayer-link], [data-tcgplayer-card]');
  if (!link) return;
  const props = {
    card: (link.dataset.tcgplayerCard || '').slice(0, 120) || undefined,
    set: (link.dataset.tcgplayerSet || '').slice(0, 24) || undefined,
    affiliate: tcgplayerAffiliateActive(),
    surface: (link.dataset.tcgplayerSurface || 'unknown').slice(0, 40),
  };
  void sendEvents([{ name: 'tcgplayer_click', props }]);
}

if (typeof document !== 'undefined') {
  decorateStaticLinks();
  document.addEventListener('click', trackClick, true);
}
''')

write("ad-config.js", '''// AdSense is intentionally disabled until Pack One has an approved publisher/client ID.
window.PACKONE_ADSENSE = Object.freeze({
  enabled: false,
  client: '',
  slots: {
    home: '',
    articleTop: '',
    articleInline: ''
  }
});
''')

write("ads.mjs", '''function previewCreative(slot, index) {
  const variants = [
    ['Draft night, organized.', 'A realistic display-ad preview lives here after approval.', 'Explore'],
    ['Protect the cards you open.', 'Responsive inventory, visually separated from Pack One actions.', 'Shop now'],
    ['Your next draft starts here.', 'Publisher content remains the focus; ads stay outside gameplay.', 'Learn more'],
  ];
  const [headline, copy, action] = variants[index % variants.length];
  slot.innerHTML = `<div class="ad-preview-creative"><div><small>Advertisement · preview</small><strong>${headline}</strong><p>${copy}</p></div><b>${action}</b></div>`;
}

function loadGoogleAds(slots) {
  const cfg = globalThis.PACKONE_ADSENSE || {};
  if (!cfg.enabled || !cfg.client || document.body.classList.contains('is-game')) return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.client)}`;
  document.head.appendChild(script);
  slots.forEach((slot) => {
    const key = slot.dataset.adSlot;
    const id = cfg.slots?.[key] || cfg.slots?.articleTop || '';
    if (!id) return;
    slot.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.client}" data-ad-slot="${id}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    (globalThis.adsbygoogle = globalThis.adsbygoogle || []).push({});
  });
}

const slots = [...document.querySelectorAll('[data-ad-slot]')];
if (new URLSearchParams(location.search).get('adpreview') === '1') slots.forEach(previewCreative);
else loadGoogleAds(slots);
''')

# Make the product layer hide all monetized/editorial inventory the moment gameplay or utility views replace home.
replace_once(
    "product.mjs",
    """function enhanceHome() {\n  const app = document.querySelector('#app');\n  const intro = document.querySelector('.home-intro');\n  app?.classList.toggle('home-page', Boolean(intro));\n}\n""",
    """function enhanceHome() {\n  const app = document.querySelector('#app');\n  const intro = document.querySelector('.home-intro');\n  const isHome = Boolean(intro);\n  app?.classList.toggle('home-page', isHome);\n  document.body.classList.toggle('is-game', !isHome);\n}\n""",
)

# Add commerce links to meaningful post-decision surfaces only; never place them around clickable game cards.
replace_once(
    "app.js",
    "import { loadReplayJson } from './replay-data.mjs';\n",
    "import { loadReplayJson } from './replay-data.mjs';\nimport { tcgplayerUrl } from './tcgplayer.mjs';\n",
)
replace_once(
    "app.js",
    "${result.consensusTop.map((card, index) => `<div class=\"rank-row\"><span>${index + 1}</span><strong>${esc(card.name)}</strong><small>${pct(card.model_probability, 1)}</small></div>`).join('')}",
    "${result.consensusTop.map((card, index) => `<div class=\"rank-row\"><span>${index + 1}</span><strong>${esc(card.name)}</strong><small>${pct(card.model_probability, 1)}</small><a class=\"market-link\" href=\"${esc(tcgplayerUrl(card.name))}\" target=\"_blank\" rel=\"sponsored noopener\" data-tcgplayer-link=\"1\" data-tcgplayer-card=\"${esc(card.name)}\" data-tcgplayer-set=\"${esc(state.selectedSetId)}\" data-tcgplayer-surface=\"top3_consensus\">TCGplayer</a></div>`).join('')}",
)
replace_once(
    "app.js",
    "<div><span>Consensus</span><strong>${esc(result.bestName)}</strong></div>",
    "<div><span>Consensus</span><strong>${esc(result.bestName)}</strong><a class=\"market-link\" href=\"${esc(tcgplayerUrl(result.bestName))}\" target=\"_blank\" rel=\"sponsored noopener\" data-tcgplayer-link=\"1\" data-tcgplayer-card=\"${esc(result.bestName)}\" data-tcgplayer-set=\"${esc(state.selectedSetId)}\" data-tcgplayer-surface=\"full_pick_consensus\">TCGplayer</a></div>",
)

# Public homepage editorial shell stays beneath the game chooser and disappears during active play.
index = (ROOT / "index.html").read_text(encoding="utf-8")
index = index.replace('<link rel="stylesheet" href="pack1.css?v=4" />', '<link rel="stylesheet" href="pack1.css?v=5" />\n  <link rel="stylesheet" href="editorial.css?v=1" />')
index = index.replace('<button class="top-nav-button" id="leaderboard-nav" type="button">Leaders</button>', '<button class="top-nav-button" id="leaderboard-nav" type="button">Leaders</button>\n        <a class="top-nav-button top-nav-link" href="/learn/">Learn</a>\n        <a class="top-nav-button top-nav-link" href="/methodology/">Method</a>')

set_cards = ''.join(f'''<article class="content-card"><p class="kicker">{escape(s['name'])} archive</p><h3>{escape(s['name'])} opening packs</h3><p>{s['replays']} replay seats · {s['close_pct']:.0%} of opening packs were close calls within 10 support points.</p><a href="/sets/{s['id']}/">See the set analysis</a></article>''' for s in set_stats)
home_editorial = f'''
    <section class="home-editorial" id="home-editorial" aria-label="Pack One guides and methodology">
      <hr class="editorial-rule" />
      {ad('home')}
      <div class="home-editorial-head"><p class="kicker">Beyond the score</p><h2>Learn what the consensus is telling you.</h2><p>Pack One is a game first, but the score only becomes useful when you understand the model behind it. These guides explain how the replay works, what support percentages mean, and how to use disagreement as a study tool rather than treating the model as an answer key.</p></div>
      <div class="guide-grid">
        <article class="content-card"><h3>How Pack One works</h3><p>Why the packs are real replay seats, why later cards stay fixed, and what Top 3 versus Full Pack is actually measuring.</p><a href="/how-it-works/">Read the explainer</a></article>
        <article class="content-card"><h3>How scoring works</h3><p>A plain-English guide to consensus support, ranking quality, decision weight, and why a 90 is not a 90% chance of being correct.</p><a href="/scoring/">Understand the score</a></article>
        <article class="content-card"><h3>Methodology</h3><p>See the strong-player cohort, pool-conditioned model, holdout approach, limitations, and the line between descriptive consensus and objective truth.</p><a href="/methodology/">Read the methodology</a></article>
        <article class="content-card"><h3>First-pick discipline</h3><p>Use opening packs to practice committing before the reveal, separating card strength from confidence, and reviewing close calls.</p><a href="/learn/first-pick-discipline/">Read the guide</a></article>
      </div>
      <div class="home-editorial-head" style="margin-top:42px"><p class="kicker">Set archive</p><h2>1,200 opening-pack replay seats.</h2><p>Each set page summarizes the actual Pack One replay sample, including how often the model found a clear first pick, which cards most often led opening packs, and the closest decisions in the archive.</p></div>
      <div class="guide-grid">{set_cards}</div>
      <p class="affiliate-note"><strong>Commerce disclosure:</strong> Pack One may earn a commission from eligible purchases made through TCGplayer links after the affiliate program is activated. Marketplace links never affect scores, rankings, or recommendations.</p>
    </section>
'''
index = index.replace('    <main id="app" class="app" aria-live="polite"></main>\n  </div>', '    <main id="app" class="app" aria-live="polite"></main>\n' + home_editorial + '  </div>')
index = index.replace('  <script src="leaderboard-config.js"></script>\n  <script type="module" src="bootstrap.mjs"></script>', '  <script src="leaderboard-config.js"></script>\n  <script src="ad-config.js"></script>\n  <script src="tcgplayer-config.js"></script>\n  <script type="module" src="bootstrap.mjs"></script>\n  <script type="module" src="ads.mjs"></script>')
(ROOT / "index.html").write_text(index, encoding="utf-8")

# Pack One CSS additions are small and intentionally share the editorial design vocabulary.
with (ROOT / "pack1.css").open("a", encoding="utf-8") as handle:
    handle.write(r'''

/* Editorial / monetization shell */
.top-nav-link{display:inline-flex;align-items:center;text-decoration:none}.home-editorial .ad-slot{margin:18px 0 38px}.rank-row{gap:8px}.rank-row small{margin-left:auto}.rank-row .market-link{margin-left:2px}.feedback-grid>div{min-width:0}.feedback-grid .market-link{display:block;margin-top:3px}.is-game .home-editorial{display:none}
''')

# Static pages.
how_body = '''
<h2>The pack is real; your line is hypothetical.</h2><p>Every Pack One game starts from a historical Premier Draft seat represented in the replay dataset. The cards in the opening pack and the later packs come from that recorded seat. You are free to make different choices, but Pack One does not pretend those alternate choices would have caused the rest of the draft to change.</p><p>That distinction is intentional. Pack One is a decision-comparison game, not a bot-driven draft simulator. Keeping the replay fixed lets two players face the same information and lets the model compare choices without inventing unseen packs.</p>
<h2>Top 3 and Full Pack answer different questions.</h2><p><strong>Top 3</strong> asks you to rank the three starts you most want from the opening pack. It is fast and especially useful for separating a confident first pick from a cluster of cards you consider close. <strong>Full Pack</strong> follows every decision in the first booster and weights later decisions less as the number of meaningful alternatives shrinks.</p><div class="callout"><strong>Daily Challenge is the competitive version.</strong> Everyone receives the same replay seat for the day, and the first eligible score is the one that enters the leaderboard. Unlimited games are practice.</div>
<h2>The reveal is comparison, not correction.</h2><p>The strongest use of Pack One is to make the choice before seeing the model. On reveal, ask three questions: Did I identify the same group of plausible cards? Did I rank them differently? Was the model itself confident, or was the top of the pack tightly clustered?</p><p>A disagreement in a close pack is a different kind of learning signal from a disagreement where one card receives much more support than everything else. The score compresses the session into a useful number, but the shape of the support is where the study value lives.</p>
<h2>Historical drafter choice stays separate.</h2><p>The replay records what the original drafter selected. Pack One shows that choice as context, but it is not treated as the correct answer. The consensus model is trained from a broader cohort of experienced, high-win-rate drafts, so the historical pick and the model can disagree.</p>'''
write("how-it-works/index.html", article_page("How Pack One works", "A practical guide to replay seats, Top 3, Full Pack, Daily Challenge, and what the reveal actually means.", "/how-it-works/", how_body, "Game guide"))

scoring_body = '''
<h2>A 92 is an alignment score, not a probability.</h2><p>Pack One scores measure how closely your choices track the strong-player consensus model for the cards that were actually available. A score of 92 does not mean your pick had a 92% chance of being correct, winning the draft, or producing a trophy. The model probabilities are comparative support values inside the decision, not calibrated outcome probabilities.</p>
<h2>Full Pack rewards meaningful decisions.</h2><p>For an individual pick, the selected card is compared with the most-supported card in that pack. Support is transformed so that a near miss remains close rather than collapsing into a binary right/wrong result. The final Full Pack score also accounts for how many real alternatives remained. An early pick from fourteen cards carries more information than a forced final pick, so late decisions receive less weight.</p><p>This is why Full Pack can distinguish between a drafter who repeatedly chooses from the consensus cluster and one who consistently takes the least-supported option, without pretending every pick has equal strategic importance.</p>
<h2>Top 3 is mostly about the set, then the order.</h2><p>Top 3 scoring puts most of its weight on whether your three selected cards belong in the model's strongest group, with a smaller component for putting those cards in the same order. That means reversing three very strong cards should still score well, while replacing one of the true contenders with a much weaker card should cost more.</p><div class="callout"><strong>The useful question is not “Was I wrong?”</strong> Ask whether you missed the model's candidate set, disagreed only on ordering, or found a genuinely low-confidence pack where multiple answers had strong support.</div>
<h2>Consensus support is descriptive.</h2><p>The model summarizes patterns in a selected cohort of experienced 17Lands drafters and conditions those tendencies on the cards already in the replay pool. It is designed to describe strong-player behavior more intelligently than a raw pick-rate table. It does not claim to establish objective card grades.</p>
<h2>Scores are for comparison over time.</h2><p>The most meaningful use of the 100-point scale is relative: compare your own sessions, compare the same seeded pack with a friend, or compare Daily Challenge standings. Do not read small point differences as scientific certainty. A score is a compact feedback signal attached to a richer decision record.</p>'''
write("scoring/index.html", article_page("How Pack One scoring works", "What the 100-point score measures, how Top 3 differs from Full Pack, and why support is not win probability.", "/scoring/", scoring_body, "Scoring"))

method_body = '''
<h2>Source data</h2><p>Pack One uses public 17Lands Premier Draft data to construct historical replay seats. The site stores a fixed sample of replay drafts for each supported set. Card images are loaded from Scryfall. Pack One is not affiliated with 17Lands, Scryfall, Wizards of the Coast, or TCGplayer.</p>
<h2>The strong-player cohort</h2><p>The model is trained on an experienced, high-win-rate slice of the available draft data rather than every drafter equally. The exact cutoff and training sample are recorded in each set manifest and surfaced on the set archive pages. This makes the target explicitly “what this stronger cohort tended to support,” not “what all players picked.”</p>
<h2>Pool-conditioned support</h2><p>A first-pick model can rely heavily on global card preference because the pool is empty. Later in the pack, however, context matters. Pack One's current model adjusts card support using shrinkage-weighted card and pool co-pick information, then normalizes support among the cards available at that decision. The pool remains the historical replay pool so every player receives the same reproducible comparison.</p>
<h2>Evaluation and holdout</h2><p>Training and evaluation are separated by draft identifier using a five-fold holdout. That reduces leakage from seeing other picks from the same draft during training. Pack One also evaluates whether the model separates historical strong-player choices from deliberately poor or random baselines. Those checks are useful evidence that the score has discrimination, but they do not turn the model into a universal definition of optimal drafting.</p>
<h2>What the probabilities are not</h2><p>The displayed percentages are not calibrated probabilities that a card is correct. They are normalized model support within the current pack. A 40% card and a 35% card represent a much closer decision than a 70% card and a 10% card, but neither percentage should be interpreted as expected win rate or chance to trophy.</p><div class="callout"><strong>Model humility is part of the product.</strong> Pack One should be most interesting where good drafters can inspect a disagreement, understand the model's confidence, and decide whether the model saw something they missed—or whether they still prefer their own line.</div>
<h2>Versioning</h2><p>Every set manifest includes the model version, source date, cohort definition, training counts, and replay count. When the scoring or model changes materially, Pack One treats that as a versioned product change rather than silently rewriting what old scores meant.</p>'''
write("methodology/index.html", article_page("Methodology", "How Pack One builds strong-player consensus from replay data, where the model is useful, and where its claims stop.", "/methodology/", method_body, "Model notes"))

articles = {
"first-pick-discipline": ("First-pick discipline: commit before the reveal", "A repeatable way to use opening packs to separate card strength, confidence, and hindsight.", '''<h2>Make the ranking before you look for permission.</h2><p>Opening packs are deceptively comfortable because there is no existing pool to constrain you. That makes them perfect for practicing a specific skill: turning a noisy set of plausible cards into an explicit order. The value comes from committing before the reveal, not from recognizing a good card after the model highlights it.</p><p>Start by identifying the cards you believe are serious first-pick candidates. Then force yourself to rank three. The third slot matters: it reveals whether you have a real tier or are simply naming the obvious rare and the best removal spell.</p><h2>Separate strength from confidence.</h2><p>You can prefer Card A to Card B while still believing the decision is close. Record both ideas mentally. When Pack One reveals a narrow support margin, a disagreement may simply mean that two strong options are genuinely clustered. When the model shows a large gap, the disagreement deserves more investigation.</p><h2>Review categories, not just card names.</h2><p>After a miss, ask what caused it. Did you overvalue raw rate? Discount flexibility? Prefer synergy before having a reason to commit? Misread a color-intensive cost? The transferable lesson is usually a category of reasoning, not “remember that this specific card is better.”</p><div class="callout"><strong>A useful routine:</strong> rank three, state your confidence, reveal, then write one sentence explaining the largest difference between your ranking and the model.</div><h2>Use repetition without memorizing.</h2><p>Unlimited packs are useful until you start recognizing the exact replay. At that point, switch sets or come back later. The goal is repeated decision structure, not learning an answer key.</p>'''),
"reading-consensus": ("How to read consensus without treating it as truth", "Use the shape of model support to distinguish strong signals from legitimately close Limited decisions.", '''<h2>The gap matters as much as the winner.</h2><p>A leaderboard-style list of cards can tempt you to focus only on which card is first. Pack One is more informative when you look at how support is distributed. If the top two cards are nearly tied, the model is describing a cohort with meaningful disagreement. If the first card is far ahead, the cohort is much more concentrated.</p><h2>Three kinds of disagreement</h2><p><strong>Candidate-set disagreement</strong> happens when your preferred card is outside the cluster the model considers strongest. <strong>Ordering disagreement</strong> happens when you and the model identify the same strong cards but rank them differently. <strong>Confidence disagreement</strong> happens when you think a pick is obvious but the model is split, or vice versa.</p><p>Those three cases deserve different review. Candidate-set misses often point to valuation or contextual blind spots. Ordering differences are more likely to be subtle preferences. Confidence differences are invitations to inspect why one side believes the pack is more decisive.</p><h2>Do not convert support into win rate.</h2><p>Normalized support only compares the cards in front of you under this model. It does not say that selecting a 55% card produces a 55% match win rate, or that a 20% card is wrong 80% of the time. The numbers are a language for relative preference.</p><div class="callout"><strong>Best use:</strong> treat consensus as a second opinion from a reproducible model of strong-player behavior. A second opinion is valuable precisely because you can disagree with it.</div><h2>Look for patterns across sessions.</h2><p>One disagreement can be noise. Ten similar disagreements can be a tendency. If your misses repeatedly involve multicolor cards, expensive interaction, narrow synergy pieces, or flexible lands, that pattern is more useful than any single grade.</p>'''),
"staying-open": ("Staying open is not the same as avoiding commitment", "A first-pack framework for flexibility: when optionality has value, and when it becomes an excuse not to take the best card.", '''<h2>Optionality has a price.</h2><p>Limited players often say they want to stay open, but openness is not free. Taking a flexible card over a substantially stronger committed card means paying real card quality for future options. Sometimes that trade is correct. The useful question is how much quality you are giving up and what information you expect to gain.</p><h2>Early picks can carry different kinds of flexibility.</h2><p>A strong monocolor card keeps more futures available than a similarly strong gold card. A colorless card may be even easier to use, but that does not automatically make it the best pick. Flexibility is one attribute in the decision, not a replacement for power.</p><h2>Use the replay pool as context, not prophecy.</h2><p>In Full Pack, Pack One shows the historical pool entering each decision. That context helps the model reflect what experienced drafters tended to do with similar holdings. Your hypothetical picks do not rewrite the pool, so use the feature to study contextual preference rather than to simulate a branching draft.</p><div class="callout"><strong>A practical test:</strong> if you are choosing the more flexible card, say what future you are preserving and what strength you are sacrificing. If you cannot name either, “staying open” may just be a story you are telling after the fact.</div><h2>Commit when the evidence earns it.</h2><p>Good drafting is not maximal flexibility. It is flexible enough to react to information and decisive enough to capitalize when the signal is real. Review your Pack One misses for both errors: committing too early and refusing to commit when the payoff is already visible.</p>''')
}
for slug, (title, deck, body) in articles.items():
    write(f"learn/{slug}/index.html", article_page(title, deck, f"/learn/{slug}/", body, "Limited study"))

learn_cards = ''.join(f'<article class="content-card"><h2>{escape(title)}</h2><p>{escape(deck)}</p><a href="/learn/{slug}/">Read guide</a></article>' for slug, (title, deck, _) in articles.items())
write("learn/index.html", head("Learn Limited with Pack One", "Guides for using replay decisions and strong-player consensus to study Limited drafting.", "/learn/") + f'''<main class="editorial-main"><section class="landing-hero"><p class="kicker">Learn</p><h1>Use the reveal to study your decisions.</h1><p class="deck">Pack One is designed around commitment before feedback. These guides focus on the reasoning habits that transfer from one set to the next.</p></section>{ad('article-top')}<section class="guide-grid">{learn_cards}</section></main>''' + footer())

# Set archive pages with original statistics computed from the 1,200 production replays.
set_index_cards = []
for s in set_stats:
    top_cards = ''.join(f'''<div class="market-card">{f'<img src="{escape(card["image"], quote=True)}" alt="{escape(card["name"], quote=True)}" loading="lazy" />' if card['image'] else ''}<strong>{escape(card['name'])}</strong><a href="#" data-tcgplayer-card="{escape(card['name'], quote=True)}" data-tcgplayer-set="{s['id']}" data-tcgplayer-surface="set_archive">TCGplayer</a></div>''' for card in s["top_cards"])
    tough_rows = ''.join(f'''<tr><td>{escape(row['top'])}</td><td>{escape(row['second'])}</td><td>{row['p1']:.1%}</td><td>{row['p2']:.1%}</td><td>{row['margin']:.1%}</td></tr>''' for row in s["toughest"])
    body = f'''
<h2>What is in the {escape(s['name'])} sample?</h2><p>This archive uses {s['replays']} historical replay seats. The consensus model for this set was trained from {s['training_drafts']:,} drafts and {s['training_picks']:,} picks drawn from an experienced cohort of {s['experienced_drafts']:,} drafts. The recorded win-rate cutoff for the cohort is {s['cutoff']:.0%}.</p>
<div class="set-metrics"><div><strong>{s['avg_top']:.1%}</strong><span>Average support for #1</span></div><div><strong>{s['close_pct']:.0%}</strong><span>Opening packs within 10 pts</span></div><div><strong>{s['historical_agreement']:.0%}</strong><span>Historical pick matched #1</span></div></div>
<h2>How decisive were the opening packs?</h2><p>Across these replay seats, the model's average gap between its first and second cards was {s['avg_margin']:.1%}. {s['close_pct']:.0%} of packs had a gap of ten support points or less, while {s['clear_pct']:.0%} had a gap of thirty points or more. That split is useful when reviewing a miss: a narrow disagreement is not the same signal as passing a card the model strongly separated from the field.</p>
<h2>Cards that most often led the opening pack</h2><p>These are not a set ranking or a pick-order list. They are the cards that appeared as the model's most-supported card most often in this particular 300-seat replay sample. Frequency depends on which cards were opened.</p><div class="market-grid">{top_cards}</div><p class="affiliate-note"><strong>Affiliate disclosure:</strong> TCGplayer links are marked sponsored. After Pack One's Impact partnership is activated, eligible purchases may generate a commission at no added cost to the buyer.</p>
<h2>Three of the closest opening decisions in the archive</h2><p>These packs produced the smallest support gaps between the top two cards in the sample. They are especially useful challenge packs because the model itself expresses little separation.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Model #1</th><th>Model #2</th><th>#1 support</th><th>#2 support</th><th>Gap</th></tr></thead><tbody>{tough_rows}</tbody></table></div>
<h2>How to use this page</h2><p>Use the statistics to calibrate your expectations before treating a score as a verdict. A set with many close opening decisions should naturally produce more reasonable disagreement. The archive is descriptive of the stored replay sample and model version; it is not a complete ranking of every card or every possible pack.</p>'''
    write(f"sets/{s['id']}/index.html", article_page(f"{s['name']} Pack One archive", f"Original analysis of {s['replays']} {s['name']} replay seats: consensus confidence, close calls, recurring opening-pick leaders, and model context.", f"/sets/{s['id']}/", body, "Set archive"))
    set_index_cards.append(f'''<article class="content-card"><p class="kicker">Data date {escape(s['date'])}</p><h2>{escape(s['name'])}</h2><p>{s['replays']} seats · {s['close_pct']:.0%} close opening calls · {s['historical_agreement']:.0%} historical/model first-pick agreement.</p><a href="/sets/{s['id']}/">Open archive</a></article>''')

write("sets/index.html", head("Pack One set archive", "Original replay-sample analysis for every Limited set currently playable in Pack One.", "/sets/") + f'''<main class="editorial-main"><section class="landing-hero"><p class="kicker">Set archive</p><h1>The replay data behind the game.</h1><p class="deck">Each archive page summarizes the actual stored replay sample rather than publishing a generic card tier list.</p></section>{ad('article-top')}<section class="set-grid">{''.join(set_index_cards)}</section></main>''' + footer())

about_body = '''<h2>A draft decision game, not a tier-list site.</h2><p>Pack One turns historical Limited draft seats into short, replayable decision games. The core experience is deliberately simple: make a pick or rank a Top 3 before seeing the strong-player consensus, then compare your reasoning with the model and with friends on the exact same pack.</p><h2>Why build it this way?</h2><p>Draft advice is often delivered after the fact, when the answer is already visible. Pack One is built around commitment before feedback. That creates a cleaner record of what you actually believed in the moment and makes disagreement more useful.</p><h2>Independence and attribution</h2><p>Pack One is an independent project. It uses public 17Lands draft data and card images served by Scryfall. Magic: The Gathering and its card names are property of their respective rights holders. Pack One is not endorsed by or affiliated with Wizards of the Coast, 17Lands, Scryfall, Google, or TCGplayer.</p><h2>Corrections and feedback</h2><p>Model, data, accessibility, and product issues can be reported through the public project repository. The goal is to make scoring claims inspectable and keep the difference between modeled consensus and objective truth explicit.</p>'''
write("about/index.html", article_page("About Pack One", "Why Pack One exists, how the product approaches Limited study, and the project's data and affiliation boundaries.", "/about/", about_body, "About"))

contact_body = '''<h2>Product and data feedback</h2><p>For bug reports, methodology questions, data corrections, accessibility issues, or feature requests, use the Pack One GitHub repository issue tracker. Public issues make technical corrections visible and easier to follow.</p><h2>Partnerships and sponsorship</h2><p>Pack One is preparing for advertising and commerce partnerships that fit the Limited audience without putting ads inside active gameplay. Partnership contact details will move to the Pack One domain as part of the domain launch; until then, the repository is the public contact point.</p><p><a class="button-link" href="https://github.com/killjoy00/mtg-ev-analyzer/issues" target="_blank" rel="noopener">Open the issue tracker</a></p>'''
write("contact/index.html", article_page("Contact Pack One", "Where to report product issues, data corrections, methodology questions, and partnership inquiries.", "/contact/", contact_body, "Contact"))

privacy_body = '''<h2>What Pack One stores</h2><p>Pack One uses browser storage for guest identity, game history, preferences, Daily Challenge history, and other product state needed to keep the experience working across visits. Optional accounts can sync game records through Pack One's backend services.</p><h2>Analytics</h2><p>Pack One records product events such as page views, game starts, reveals, challenge opens, challenge completions, shares, and outbound commerce clicks. These events are used to understand whether the product works and where players stop in the experience. Do not put sensitive personal information into a display name.</p><h2>Advertising</h2><p>Google advertising is not enabled until Pack One has an approved AdSense configuration. If Google-served advertising is enabled later, the site will update this policy and use the consent controls required for applicable regions before personalized advertising is served.</p><h2>Commerce links</h2><p>Links to TCGplayer may be affiliate links. Pack One can record that an outbound TCGplayer link was clicked, including the card, set, page surface, and whether affiliate routing was active. Purchases and payment details are handled by TCGplayer and its partners, not by Pack One.</p><h2>Third-party services</h2><p>Card images are requested from Scryfall. Game and analytics services are hosted using infrastructure providers used by Pack One. External sites have their own privacy practices once you leave Pack One.</p>'''
write("privacy/index.html", article_page("Privacy", "A plain-English description of Pack One browser storage, analytics, optional accounts, advertising preparation, and affiliate links.", "/privacy/", privacy_body, "Policy"))

terms_body = '''<h2>Use of the site</h2><p>Pack One is provided as an educational and entertainment tool for comparing Limited draft decisions. Scores and model support are informational. They are not guarantees of tournament results, card value, or financial return.</p><h2>Data and trademarks</h2><p>Replay analysis is derived from public 17Lands draft data according to the source information recorded in each set manifest. Magic: The Gathering card names, art, and related marks belong to their respective rights holders. Pack One is independent and is not endorsed by Wizards of the Coast or the third-party services it references.</p><h2>External links</h2><p>Pack One may link to marketplaces and other external resources. Those destinations control their own products, pricing, availability, terms, and privacy practices. Affiliate relationships do not change Pack One scores or model outputs.</p><h2>No warranty</h2><p>The site and model are provided as-is. Draft datasets, card metadata, third-party services, and model outputs can contain errors or change over time. Pack One may update the product, scoring, or supported data and will version material methodology changes where practical.</p>'''
write("terms/index.html", article_page("Terms", "Terms for using Pack One, including scoring limitations, external links, data attribution, and independence.", "/terms/", terms_body, "Policy"))

disclosure_body = '''<h2>TCGplayer affiliate relationship</h2><p>Pack One is preparing to participate in TCGplayer's affiliate program through Impact. When affiliate routing is active, links labeled for TCGplayer are sponsored/affiliate links and Pack One may earn a commission from eligible purchases. The price a buyer pays is not increased by Pack One's commission.</p><h2>Editorial independence</h2><p>Commerce relationships do not influence consensus support, card rankings, Daily Challenge results, or scoring. The model is generated from the draft-data workflow, not from marketplace prices or affiliate payouts.</p><h2>Advertising</h2><p>Display advertising, if enabled, is visually separated from editorial content and is excluded from active gameplay. Pack One does not ask users to click ads, and ads are not presented as game controls or recommendations.</p><h2>How links are labeled</h2><p>TCGplayer links use sponsored link attributes and are accompanied by disclosure language on pages where commerce links appear. This page is the standing site-wide disclosure for advertising, sponsorship, and affiliate relationships.</p>'''
write("disclosure/index.html", article_page("Advertising & affiliate disclosure", "How Pack One separates editorial/scoring decisions from TCGplayer affiliate links, sponsorship, and display advertising.", "/disclosure/", disclosure_body, "Disclosure"))

# Search engine plumbing. Canonicals stay on the current live domain until the domain migration itself.
paths = ["/", "/how-it-works/", "/scoring/", "/methodology/", "/learn/", "/sets/", "/about/", "/contact/", "/privacy/", "/terms/", "/disclosure/"]
paths += [f"/learn/{slug}/" for slug in articles]
paths += [f"/sets/{s['id']}/" for s in set_stats]
write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{ORIGIN}{path}</loc></url>\n' for path in paths) + '</urlset>')
write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {ORIGIN}/sitemap.xml\n")
write("ads.txt.example", "# Replace PUB_ID after AdSense approval, then rename this file to ads.txt.\n# google.com, pub-PUB_ID, DIRECT, f08c47fec0942fa0\n")

write("MONETIZATION.md", '''# Pack One monetization setup

## TCGplayer / Impact

TCGplayer's affiliate program currently operates through Impact. Apply through the TCGplayer campaign in Impact. New TCGplayer API developer access is not currently being granted, so this integration intentionally does **not** depend on API pricing access.

After approval:

1. In Impact, create/copy the TCGplayer deep-link template for the Pack One partner account.
2. Put that public tracking template in `tcgplayer-config.js` as `impactDeepLinkTemplate`. It must contain `{url}` where the encoded TCGplayer destination belongs.
3. Do not store TCGplayer API private keys, Impact credentials, or other secrets in this repository.
4. Verify a click lands on the intended TCGplayer card search and appears in Impact reporting.
5. Keep the disclosure page and `rel="sponsored"` attributes intact.

Pack One records `tcgplayer_click` analytics with card, set, surface, and whether affiliate routing was active.

## Google AdSense

The code uses manual ad slots only; Auto Ads are intentionally not enabled. Active gameplay hides the entire editorial/monetization shell.

After AdSense approval:

1. Put the public AdSense client ID and approved slot IDs in `ad-config.js`, then set `enabled: true`.
2. Create a real `ads.txt` from `ads.txt.example` using the publisher ID supplied by AdSense.
3. Configure the required Google-certified consent flow for applicable regions before personalized advertising.
4. Keep ads out of active gameplay and away from game controls.
5. Use `?adpreview=1` for layout QA without requesting real ads.

## Domain move

Do not change canonicals or `CNAME` until `packone.pro` DNS is ready. The editorial pages currently canonicalize to the live `magic.planitnow.us` domain. Move those canonicals, sitemap origin, worker CORS allowlists, share origins, and CNAME together in the domain migration release.
''')

# Static-content guardrails.
write("tests/editorial.test.mjs", r'''import assert from 'node:assert/strict';
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
  assert.ok(words >= 430, `${path} is too thin for the editorial shell: ${words} words`);
}
const home = await readFile('index.html','utf8');
assert.match(home, /id="home-editorial"/);
assert.match(home, /data-ad-slot="home"/);
assert.match(home, /href="\/learn\/"/);
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
''')

# Browser checks: root editorial content, no ad inventory during play, and a realistic ad-layout screenshot.
e2e_path = ROOT / "tests/e2e.mjs"
e2e = e2e_path.read_text(encoding="utf-8")
e2e = e2e.replace("  await assertNoHorizontalOverflow();\n}\n\nasync function revealTop3()", "  assert.equal(await page.locator('#home-editorial').isVisible(), true, 'editorial shell should be visible on home');\n  await assertNoHorizontalOverflow();\n}\n\nasync function revealTop3()")
e2e = e2e.replace("  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });\n  assert.equal(await page.locator('.challenge-callout').count(), 0, 'ordinary game must not look like a friend challenge');", "  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });\n  assert.equal(await page.locator('#home-editorial').isVisible(), false, 'editorial/ad inventory must disappear during active play');\n  assert.equal(await page.locator('.challenge-callout').count(), 0, 'ordinary game must not look like a friend challenge');")
e2e = e2e.replace("  await page.screenshot({ path: 'artifacts/ui-home-desktop.png', fullPage: true });\n", "  await page.screenshot({ path: 'artifacts/ui-home-desktop.png', fullPage: true });\n  await page.goto(`${base}/?adpreview=1`, { waitUntil: 'domcontentloaded' });\n  await page.locator('#set-select').waitFor({ timeout: 10000 });\n  await page.locator('.ad-preview-creative').waitFor({ timeout: 5000 });\n  await page.screenshot({ path: 'artifacts/ui-monetization-preview-desktop.png', fullPage: true });\n  await home();\n")
e2e_path.write_text(e2e, encoding="utf-8")

print(json.dumps({"sets": [{"id": s["id"], "close_pct": round(s["close_pct"], 3), "avg_margin": round(s["avg_margin"], 3)} for s in set_stats], "pages": len(paths)}, indent=2))
