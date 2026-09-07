#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:80]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# Exact next-pack preloading. The lookahead seed is reserved on the result page,
# the exact shard for that seed is warmed, and the New Pack click reuses it.
# ---------------------------------------------------------------------------
replace_once(
    "replay-data.mjs",
    "const responseCache = new Map();",
    "import { seededRandom } from './gameplay.mjs';\n\nconst responseCache = new Map();",
)

replace_once(
    "replay-data.mjs",
    "export function clearReplayCache() {",
    """export function seededReplayPlan(setData, seed) {
  const shards = (setData?.shards || []).filter((shard) => Number(shard?.replay_count) > 0 && shard?.path);
  const total = shards.reduce((sum, shard) => sum + Number(shard.replay_count), 0);
  if (!total || !seed) return null;
  const random = seededRandom(seed);
  let ticket = Math.floor(random() * total);
  let selected = shards[shards.length - 1];
  for (const shard of shards) {
    ticket -= Number(shard.replay_count);
    if (ticket < 0) {
      selected = shard;
      break;
    }
  }
  return {
    shard: selected,
    replayIndex: Math.floor(random() * Number(selected.replay_count)),
  };
}

export async function preloadSeededReplay({ setId, seed }) {
  const catalog = catalogSnapshot || await loadReplayJson('./data/catalog.json', 'catalog');
  const set = catalog?.sets?.find((entry) => entry.id === setId);
  const manifestPath = set?.manifest || set?.manifest_path;
  if (!manifestPath) return null;
  const setData = await loadReplayJson(manifestPath, set?.name || 'set manifest');
  const plan = seededReplayPlan(setData, seed);
  if (!plan?.shard?.path) return null;
  await loadReplayJson(plan.shard.path, `${set?.name || setId} next replay shard`);
  return plan;
}

export function clearReplayCache() {""",
)

# ---------------------------------------------------------------------------
# Product loop: exact challenge sharing for both modes + prepared next seed.
# ---------------------------------------------------------------------------
replace_once(
    "product.mjs",
    "import { onAppRender } from './render-lifecycle.mjs';",
    "import { onAppRender } from './render-lifecycle.mjs';\nimport { preloadSeededReplay } from './replay-data.mjs';",
)
replace_once(
    "product.mjs",
    "let autoStarted = false;",
    "let autoStarted = false;\nlet preparedNextGame = null;",
)

replace_once(
    "product.mjs",
    """function beginFreshGame(mode) {
  const seed = freshSeed();
  seedGameRandom(seed);
  setGameUrl({ seed, mode, setId: currentSet() });
  return seed;
}
""",
    """function beginFreshGame(mode) {
  const setId = currentSet();
  const prepared = preparedNextGame?.mode === mode && preparedNextGame?.setId === setId ? preparedNextGame : null;
  const seed = prepared?.seed || freshSeed();
  preparedNextGame = null;
  seedGameRandom(seed);
  setGameUrl({ seed, mode, setId });
  return seed;
}

function prepareNextGame(mode) {
  const setId = currentSet();
  const sourceSeed = currentSeed();
  if (!setId || !sourceSeed || !mode) return;
  const key = `${setId}:${mode}:${sourceSeed}`;
  if (preparedNextGame?.key === key) return;
  const seed = freshSeed();
  preparedNextGame = { key, setId, mode, seed };
  void preloadSeededReplay({ setId, seed }).catch(() => null);
}

function emitShareCompleted(method, context = 'challenge') {
  document.dispatchEvent(new CustomEvent('pack1:share-completed', {
    detail: { method, context, challenge: true },
  }));
}
""",
)

regex_once(
    "product.mjs",
    r"async function shareSeededGame\(button, mode\) \{.*?\n\}\n\nasync function copySeededLink",
    """async function shareSeededGame(button, mode) {
  const score = resultScore();
  const grade = document.querySelector('.grade-badge')?.textContent || '';
  const url = seededChallengeUrl(score, mode);
  const challenger = playerName();
  const text = `${challenger} scored ${score}/100 in Pack One ${mode === 'full' ? 'Full Pack' : 'Top 3'}${grade ? ` (${grade})` : ''}.\nSame exact pack. Can you beat that?`;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Making challenge…';
  try {
    const blob = await scoreImage({ score, grade, mode, setId: currentSet() });
    const file = blob ? new File([blob], 'pack1-result.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'Pack One challenge', text, url, files: [file] });
      emitShareCompleted('native_file', 'result_challenge');
    } else if (navigator.share) {
      await navigator.share({ title: 'Pack One challenge', text, url });
      emitShareCompleted('native', 'result_challenge');
    } else {
      await copyText(`${text}\n${url}`);
      button.textContent = 'Challenge copied';
      emitShareCompleted('copy_fallback', 'result_challenge');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      await copyText(`${text}\n${url}`).catch(() => null);
      button.textContent = 'Challenge copied';
      emitShareCompleted('copy_fallback', 'result_challenge');
    }
  }
  setTimeout(() => { button.disabled = false; button.textContent = original; }, 1300);
}

async function copySeededLink""",
)

replace_once(
    "product.mjs",
    """async function copySeededLink(button, mode) {
  const score = resultScore();
  await copyText(seededChallengeUrl(score, mode));
  const original = button.textContent;
  button.textContent = 'Link copied';
  setTimeout(() => { button.textContent = original; }, 1200);
}
""",
    """async function copySeededLink(button, mode) {
  const score = resultScore();
  await copyText(seededChallengeUrl(score, mode));
  emitShareCompleted('copy_link', 'result_challenge');
  const original = button.textContent;
  button.textContent = 'Link copied';
  setTimeout(() => { button.textContent = original; }, 1200);
}

function prioritizeChallenge(actions, share, another) {
  if (!actions || !share) return;
  share.textContent = 'Challenge a friend';
  share.classList.remove('share-button', 'secondary');
  share.classList.add('primary', 'challenge-primary');
  if (another) {
    another.classList.remove('primary');
    another.classList.add('secondary');
  }
  actions.prepend(share);
}
""",
)

replace_once(
    "product.mjs",
    """  if (another) another.textContent = isDailyResult(reveal) ? 'Play another game' : 'New pack';
  if (share) share.textContent = 'Challenge a friend';
  if (home) home.textContent = 'Home';
  if (actions && currentSeed()) addReplayButton(actions, 'top3');

  window.scrollTo({ top: 0, behavior: 'auto' });
""",
    """  if (another) another.textContent = isDailyResult(reveal) ? 'Play another game' : 'New pack';
  if (home) home.textContent = 'Home';
  prioritizeChallenge(actions, share, another);
  if (actions && currentSeed()) addReplayButton(actions, 'top3');
  prepareNextGame('top3');

  window.scrollTo({ top: 0, behavior: 'auto' });
""",
)

replace_once(
    "product.mjs",
    """  if (another) another.textContent = isDailyResult(scorecard) ? 'Play another game' : 'New pack';
  if (share) share.textContent = currentSeed() ? 'Challenge a friend' : 'Share score';
  if (home) home.textContent = 'Home';
  const actions = scorecard.querySelector('.result-actions');
  if (actions && currentSeed()) addReplayButton(actions, 'full');
  window.scrollTo({ top: 0, behavior: 'auto' });
""",
    """  if (another) another.textContent = isDailyResult(scorecard) ? 'Play another game' : 'New pack';
  if (home) home.textContent = 'Home';
  const actions = scorecard.querySelector('.result-actions');
  prioritizeChallenge(actions, share, another);
  if (actions && currentSeed()) addReplayButton(actions, 'full');
  prepareNextGame('full');
  window.scrollTo({ top: 0, behavior: 'auto' });
""",
)

replace_once(
    "product.mjs",
    """  const shareFull = event.target.closest?.('#share-full');
  if (shareFull && currentSeed()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void shareSeededGame(shareFull, 'full');
  }
""",
    """  const share = event.target.closest?.('#share-top3, #share-full');
  if (share && currentSeed()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void shareSeededGame(share, share.id === 'share-full' ? 'full' : 'top3');
  }
""",
)

# ---------------------------------------------------------------------------
# Source-owned home simplification + share-completion hook for Daily sharing.
# ---------------------------------------------------------------------------
replace_once(
    "app.js",
    "Draft real opening packs from 17Lands. Rank your Top 3 or play the full first pack, then compare your choices with the strong-player consensus.",
    "One real opening pack. Make your picks, see how you line up with strong-player consensus, then put the same pack in front of a friend.",
)

regex_once(
    "app.js",
    r"    <section class=\"daily-card daily-feature\" id=\"daily-challenge\">.*?    </section>\n\n    <section class=\"mode-grid\" aria-label=\"Choose a game mode\">.*?    </section>\n\n    <section class=\"data-note\">",
    """    <section class=\"daily-card daily-feature\" id=\"daily-challenge\">
      <div class=\"daily-copy\">
        <div class=\"daily-kicker\"><span class=\"live-dot\"></span><span>Daily Challenge</span><span class=\"streak-chip\">${streak ? `${streak}-day streak` : 'Start a streak'}</span></div>
        <h2>Today’s Pack One</h2>
        <p>Everyone gets the same draft seat. Top 3 is the fastest way in; your first score is the one that reaches today’s board.</p>
        ${milestoneMarkup()}
      </div>
      <div class=\"daily-actions\">
        <button class=\"button primary daily-mode daily-main\" data-daily-mode=\"top3\"><span>Play today’s Top 3</span><strong>${esc(dailyModeStatus('top3', active.id))}</strong></button>
        <button class=\"button secondary daily-mode daily-secondary\" data-daily-mode=\"full\"><span>Play the full pack</span><strong>${esc(dailyModeStatus('full', active.id))}</strong></button>
        <button class=\"text-button daily-leader-link\" id=\"daily-leaders\">See today’s leaderboard</button>
        <small>${todayRuns ? `${todayRuns} challenge ${todayRuns === 1 ? 'run' : 'runs'} completed today` : 'Nothing on the board yet today'}</small>
      </div>
    </section>

    <section class=\"mode-section\" aria-labelledby=\"more-pack-one\">
      <div class=\"mode-section-heading\">
        <div><p class=\"eyebrow\">More Pack One</p><h2 id=\"more-pack-one\">Play another pack</h2></div>
        <p>Unlimited practice. These scores stay personal; Daily Challenge is the ranked game.</p>
      </div>
      <div class=\"mode-grid\" aria-label=\"Choose a practice mode\">
        <article class=\"mode-card game-mode-row\">
          <div class=\"mode-topline\"><p class=\"eyebrow\">Opening pack</p>${bestChip('top3')}</div>
          <h3>Top 3</h3>
          <p>Rank your three best starts from a fresh opening pack.</p>
          <button class=\"button secondary mode-button\" data-mode=\"top3\">New Top 3</button>
        </article>
        <article class=\"mode-card game-mode-row\">
          <div class=\"mode-topline\"><p class=\"eyebrow\">Full first pack</p>${bestChip('full')}</div>
          <h3>Full Pack</h3>
          <p>Make every pick in Pack One and get a 100-point finish.</p>
          <button class=\"button secondary mode-button\" data-mode=\"full\">New Full Pack</button>
        </article>
      </div>
    </section>

    <section class=\"data-note\">""",
)

replace_once(
    "app.js",
    """async function shareScore(button, text, url = SHARE_URL) {
  const original = button.textContent;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pack 1', text, url });
      return;
    }
    await copyText(`${text}\n${url}`);
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = original; }, 1600);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      try {
        await copyText(`${text}\n${url}`);
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = original; }, 1600);
      } catch { /* sharing is optional */ }
    }
  }
}
""",
    """function reportShareCompleted(method, url, context = 'score') {
  let challenge = false;
  try {
    const parsed = new URL(url, SHARE_URL);
    challenge = parsed.searchParams.has('seed') || parsed.searchParams.has('daily');
  } catch { /* analytics is optional */ }
  document.dispatchEvent(new CustomEvent('pack1:share-completed', { detail: { method, context, challenge } }));
}

async function shareScore(button, text, url = SHARE_URL) {
  const original = button.textContent;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pack One', text, url });
      reportShareCompleted('native', url);
      return;
    }
    await copyText(`${text}\n${url}`);
    reportShareCompleted('copy_fallback', url);
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = original; }, 1600);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      try {
        await copyText(`${text}\n${url}`);
        reportShareCompleted('copy_fallback', url);
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = original; }, 1600);
      } catch { /* sharing is optional */ }
    }
  }
}
""",
)

# ---------------------------------------------------------------------------
# Funnel analytics: share completed, challenge started, seed-linked events.
# ---------------------------------------------------------------------------
replace_once(
    "growth.mjs",
    "let currentAccount = null;",
    "let currentAccount = null;\nlet challengeStartTracked = false;",
)
replace_once(
    "growth.mjs",
    "function event(name, props={}) { void sendEvents([{ name, props:{ ...props, path:location.pathname, set:params().get('set')||undefined, mode:params().get('mode')||undefined } }]); }",
    "function event(name, props={}) { void sendEvents([{ name, props:{ ...props, path:location.pathname, set:params().get('set')||undefined, mode:params().get('mode')||undefined, seed:params().get('seed')||undefined } }]); }",
)
replace_once(
    "growth.mjs",
    "box.innerHTML=`<span>Friend challenge</span><strong>${esc(by||'Your friend')} scored ${target}</strong><em>Same pack. Beat the score.</em>`;",
    "box.innerHTML=`<span>Friend challenge</span><strong>${esc(by||'Your friend')} scored ${target}</strong><em>Same exact pack. Beat the score.</em>`;",
)
replace_once(
    "growth.mjs",
    """  const button=document.createElement('button'); button.type='button'; button.className='button primary challenge-return'; button.textContent='Send the result back';
  button.addEventListener('click',()=>{ const share=root.querySelector('#share-top3,#share-full'); if(share) share.click(); else navigator.share?.({title:'Pack 1',url:location.href}); event('challenge_reshare'); });
  actions.prepend(button);
""",
    """  const share=root.querySelector('#share-top3,#share-full');
  if(share){share.classList.remove('primary','challenge-primary');share.classList.add('secondary');share.textContent='Challenge someone else';}
  const button=document.createElement('button'); button.type='button'; button.className='button primary challenge-return'; button.textContent='Send the result back';
  button.addEventListener('click',()=>{ if(share) share.click(); else navigator.share?.({title:'Pack One',url:location.href}); event('challenge_reshare'); });
  actions.prepend(button);
""",
)

regex_once(
    "growth.mjs",
    r"function clickAnalytics\(eventObject\) \{.*?\n\}\nfunction enhance",
    """function clickAnalytics(eventObject) {
  const target=eventObject.target.closest?.('button,a'); if(!target) return;
  if(target.matches('[data-mode]')) {
    const challenge=params().has('challenge')||params().has('vs');
    event('game_start',{ daily:false, mode:target.dataset.mode, challenge });
    if(challenge&&!challengeStartTracked){
      challengeStartTracked=true;
      event('challenge_start',{ mode:target.dataset.mode, target_score:Number(params().get('vs'))||undefined, challenger:params().get('by')||'friend' });
    }
  }
  else if(target.matches('[data-daily-mode]')) event('game_start',{ daily:true, mode:target.dataset.dailyMode });
  else if(target.matches('#reveal-top3,#reveal-challenge')) event('reveal_click');
  else if(target.matches('#share-top3,#share-full,.challenge-return,#reshare-challenge')) event('share_click',{ challenge:true, surface:target.id||'challenge_return' });
  else if(target.matches('#daily-leaders,#leaderboard-nav')) event('leaderboard_view');
}
function shareCompletedAnalytics(eventObject) {
  const detail=eventObject.detail||{};
  event('share_completed',{ method:String(detail.method||'unknown').slice(0,40), context:String(detail.context||'unknown').slice(0,40), challenge:Boolean(detail.challenge) });
}
function enhance""",
)
replace_once(
    "growth.mjs",
    "document.addEventListener('click',clickAnalytics,true);\n  onAppRender(enhance);",
    "document.addEventListener('click',clickAnalytics,true);\n  document.addEventListener('pack1:share-completed',shareCompletedAnalytics);\n  onAppRender(enhance);",
)

# ---------------------------------------------------------------------------
# Home/result styling: one dominant Daily CTA, compact practice choices, and a
# dominant challenge action on results.
# ---------------------------------------------------------------------------
css = read("pack1.css")
css = css.replace(".mode-card {\n  position: relative;\n  min-width: 0;\n  min-height: 340px;", ".mode-section { margin-top: 26px; }\n.mode-section-heading { margin-bottom: 12px; display: flex; justify-content: space-between; gap: 24px; align-items: end; }\n.mode-section-heading h2 { margin-bottom: 0; font-size: clamp(22px, 2.6vw, 30px); }\n.mode-section-heading > p { max-width: 500px; margin: 0; color: var(--muted); font-size: 12px; text-align: right; }\n.mode-card {\n  position: relative;\n  min-width: 0;\n  min-height: 210px;")
css = css.replace(".mode-number {\n  position: absolute;", ".mode-number {\n  position: absolute;")
css += """

/* Growth-loop release */
.daily-feature { padding: 34px; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .55fr); }
.daily-feature .daily-copy h2 { font-size: clamp(34px, 4.5vw, 52px); letter-spacing: -.04em; }
.daily-main { min-height: 64px; }
.daily-main span { font-size: 15px; }
.daily-secondary { min-height: 50px; }
.daily-leader-link { justify-self: center; font-size: 12px; }
.challenge-primary { min-width: 190px; }
.result-actions .challenge-primary { order: -2; }
.result-actions .challenge-return { order: -3; }

@media (max-width: 760px) {
  .mode-section-heading { display: block; }
  .mode-section-heading > p { margin-top: 6px; text-align: left; }
  .daily-feature { padding: 24px; }
  .daily-feature .daily-copy h2 { font-size: 36px; }
  .challenge-primary, .challenge-return { width: 100%; }
}
"""
write("pack1.css", css)

# Bump the single CSS entrypoint cache key and its guardrail.
replace_once("index.html", "pack1.css?v=3", "pack1.css?v=4")
replace_once("tests/architecture.test.mjs", "['pack1.css?v=3']", "['pack1.css?v=4']")

# ---------------------------------------------------------------------------
# Replay data defaults and live data resharding to 2 replays/shard.
# ---------------------------------------------------------------------------
replace_once("scripts/build_replays.py", 'parser.add_argument("--shard-size", type=int, default=10)', 'parser.add_argument("--shard-size", type=int, default=2)')
replace_once("README.md", "  --shard-size 10 \\", "  --shard-size 2 \\")

from scripts.build_replays import write_sharded_dataset  # noqa: E402

for set_id in ("msh", "sos", "tmt", "ecl"):
    set_dir = ROOT / "data" / set_id
    manifest = json.loads((set_dir / "manifest.json").read_text(encoding="utf-8"))
    replays = []
    for shard in manifest.get("shards", []):
        payload = json.loads((ROOT / shard["path"].removeprefix("./")).read_text(encoding="utf-8"))
        replays.extend(payload.get("replays", []))
    if len(replays) != int(manifest.get("replay_count", 0)):
        raise RuntimeError(f"{set_id}: expected {manifest.get('replay_count')} replays, loaded {len(replays)}")
    dataset = {key: value for key, value in manifest.items() if key not in {"replay_count", "shard_size", "shards"}}
    dataset["replays"] = replays
    new_manifest = write_sharded_dataset(dataset, set_dir, 2)
    if new_manifest["shard_size"] != 2 or new_manifest["replay_count"] != len(replays):
        raise RuntimeError(f"{set_id}: reshard validation failed")

# ---------------------------------------------------------------------------
# Analytics docs/query. No DB schema change is needed: analytics_events already
# accepts arbitrary event names and sanitized scalar props.
# ---------------------------------------------------------------------------
analytics_dir = ROOT / "analytics"
analytics_dir.mkdir(exist_ok=True)
(analytics_dir / "viral_funnel.sql").write_text("""-- Pack One viral-loop funnel. Read-only; safe to run against production.\nWITH daily AS (\n  SELECT\n    created_at::date AS day,\n    count(*) FILTER (WHERE event_name='page_view') AS page_views,\n    count(*) FILTER (WHERE event_name='game_start') AS game_starts,\n    count(*) FILTER (WHERE event_name='game_reveal') AS game_reveals,\n    count(*) FILTER (WHERE event_name='share_click') AS share_clicks,\n    count(*) FILTER (WHERE event_name='share_completed') AS share_completions,\n    count(*) FILTER (WHERE event_name='challenge_open') AS challenge_opens,\n    count(*) FILTER (WHERE event_name='challenge_start') AS challenge_starts,\n    count(*) FILTER (WHERE event_name='challenge_complete') AS challenge_completions,\n    count(*) FILTER (WHERE event_name='share_completed' AND event_props->>'method' LIKE 'native%') AS native_shares,\n    count(*) FILTER (WHERE event_name='share_completed' AND event_props->>'method' LIKE 'copy%') AS copied_shares,\n    count(DISTINCT event_props->>'seed') FILTER (WHERE event_name='share_completed' AND event_props ? 'seed') AS shared_seeds,\n    count(DISTINCT player_id) FILTER (WHERE player_id IS NOT NULL) AS identified_players\n  FROM analytics_events\n  GROUP BY created_at::date\n)\nSELECT *,\n  round(share_completions::numeric / NULLIF(game_reveals,0), 3) AS shares_per_reveal,\n  round(challenge_opens::numeric / NULLIF(share_completions,0), 3) AS opens_per_share,\n  round(challenge_starts::numeric / NULLIF(challenge_opens,0), 3) AS challenge_start_rate,\n  round(challenge_completions::numeric / NULLIF(challenge_starts,0), 3) AS challenge_completion_rate,\n  round(challenge_completions::numeric / NULLIF(game_reveals,0), 3) AS viral_completion_rate\nFROM daily\nORDER BY day DESC;\n""", encoding="utf-8")

readme = read("README.md")
readme = readme.replace(
    "`page_view -> game_start -> game_reveal -> share_click -> challenge_open -> challenge_complete`",
    "`page_view -> game_start -> game_reveal -> share_click -> share_completed -> challenge_open -> challenge_start -> challenge_complete`",
)
readme = readme.replace(
    "This is intended to answer the core viral-loop question: how often does a shared challenge turn into another completed game?",
    "This is intended to answer the core viral-loop question: how often does a completed result become a real share, then an opened, started, and completed friend challenge? `share_completed` records `native`, `native_file`, `copy_fallback`, or `copy_link`; seeded events carry the game seed so the funnel can be tied to the exact pack. Run `analytics/viral_funnel.sql` for the daily conversion view and viral completion rate.",
)
write("README.md", readme)

# ---------------------------------------------------------------------------
# Unit + browser regression coverage.
# ---------------------------------------------------------------------------
replay_test = read("tests/replay-data.test.mjs")
replay_test = replay_test.replace(
    "import { normalizeReplayPayload, rarityBucket, sortCatalogSets, sortPackByRarity } from '../replay-data.mjs';",
    "import { normalizeReplayPayload, rarityBucket, seededReplayPlan, sortCatalogSets, sortPackByRarity } from '../replay-data.mjs';",
)
replay_test += """

test('seededReplayPlan deterministically identifies the exact next shard and replay', () => {
  const manifest = { shards: [
    { path: './a.json', replay_count: 2 },
    { path: './b.json', replay_count: 2 },
    { path: './c.json', replay_count: 2 },
  ] };
  const first = seededReplayPlan(manifest, 'nextpackseed123');
  const second = seededReplayPlan(manifest, 'nextpackseed123');
  assert.deepEqual(first, second);
  assert.ok(manifest.shards.includes(first.shard));
  assert.ok(first.replayIndex >= 0 && first.replayIndex < first.shard.replay_count);
});
"""
write("tests/replay-data.test.mjs", replay_test)

e2e = read("tests/e2e.mjs")
e2e = e2e.replace("const page = await browser.newPage({ viewport: { width: 390, height: 844 } });", "const page = await browser.newPage({ viewport: { width: 390, height: 844 } });\nconst capturedEvents = [];")
e2e = e2e.replace(
    "else if (path === '/v1/events') body = { ok: true, accepted: 1 };",
    "else if (path === '/v1/events') { const payload = route.request().postDataJSON?.() || {}; capturedEvents.push(...(payload.events || []).map((item) => item.name)); body = { ok: true, accepted: 1 }; }",
)
e2e = e2e.replace(
    "assert.doesNotMatch((await page.locator('.home-intro').textContent()) || '', /defend it/i);",
    "assert.doesNotMatch((await page.locator('.home-intro').textContent()) || '', /defend it/i);\n  assert.equal(await page.getByRole('heading', { name: 'Today’s Pack One', exact: true }).count(), 1);\n  assert.equal(await page.locator('.daily-main').count(), 1);\n  assert.match((await page.locator('.daily-main').textContent()) || '', /Play today’s Top 3/i);",
)
e2e = e2e.replace(
    "if (setId === 'ecl') await page.screenshot({ path: 'artifacts/ui-result-mobile.png', fullPage: true });",
    "const challengeButton = page.locator('#share-top3');\n    assert.match((await challengeButton.textContent()) || '', /Challenge a friend/i);\n    assert.match((await challengeButton.getAttribute('class')) || '', /primary/);\n    if (setId === 'ecl') await page.screenshot({ path: 'artifacts/ui-result-mobile.png', fullPage: true });",
)
e2e = e2e.replace(
    "await page.locator('.challenge-return').waitFor({ timeout: 5000 });\n  await assertNoHorizontalOverflow();",
    "await page.locator('.challenge-return').waitFor({ timeout: 5000 });\n  await page.waitForTimeout(100);\n  assert.ok(capturedEvents.includes('challenge_start'), 'friend challenge must record a challenge_start event');\n  assert.ok(capturedEvents.includes('challenge_complete'), 'friend challenge must record a challenge_complete event');\n  await assertNoHorizontalOverflow();",
)
write("tests/e2e.mjs", e2e)

print("Growth-loop sprint changes applied and four live sets resharded to 2.")
