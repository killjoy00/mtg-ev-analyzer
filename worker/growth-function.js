import {createHmac} from 'node:crypto';
import {releaseMetadata} from './release.mjs';
import {guardIngress} from './ingress-auth.mjs';
import {consumePlayerLimit} from './request-limits.mjs';
import {readJson} from './request-json.mjs';
import {gameDateKey} from '../game-date.mjs';
import {handlePatreon} from './patreon.mjs';
import {accountSession,clearAccountCookies,clearPlayerCookie,consumeNeonSession,issueAccountSession,requireTrustedOrigin,revokeAccountSession,revokeAllAccountSessions,withAccountCookies,withPlayerCookie} from './account-session.mjs';
import {accountRuntimeConfig} from './account-config.mjs';
import {clearCredentialLimit,consumeCredentialLimit,trustedCredentialNetwork} from './account-credential-limits.mjs';
import {consumeDeletionVerification,createDeletionVerification,deletionEmailConfigured,deletionEmailForAuth} from './account-deletion-verification.mjs';
import {beginDeletion,cleanupPackOne,deletedPlayerTombstone,deletionEnabled,deletionRecoveryKey,finishProviderPhase,loadDeletionOperation,maintenanceBatch,removeProviderUser,stuckDeletion,sweepExpiredVerification,verificationSweepEnabled} from './account-deletion.mjs';
import {verifyDeletionMaintenanceToken} from './account-deletion-auth.mjs';
import {PLACEHOLDER_USERNAME,isPlaceholderUsername,isUsernameConflict,normalizeDisplayName as normalizeName,rethrowUsernameConflict} from './username.mjs';
const ACCOUNT_CONFIG=accountRuntimeConfig();
const ALLOWED_ORIGINS=ACCOUNT_CONFIG.allowedOrigins;
const TOKEN_PREFIX = 'p1_';
const NEON_AUTH_BASE=ACCOUNT_CONFIG.authBase;
const ACCOUNT_RETURN='https://packone.pro/';
const STATIC_ORIGIN = 'https://packone.pro';
const PROFILE_KEY_RE = /^[a-f0-9]{16}$/;
const DAILY_RUN_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let catalogCache = { at: 0, data: null };
let signingKeyCache = { at: 0, key: null };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control':'no-store' },
  });
}

function cors(request) {
  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-pack1-auth-session,x-pack1-csrf',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(request))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function dbUrl() {
  const url = new URL(process.env.DATABASE_URL);
  const parts = url.hostname.split('.');
  parts[0] = 'api';
  return `https://${parts.join('.')}/sql`;
}

async function query(sql, params = []) {
  const response = await fetch(dbUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': process.env.DATABASE_URL,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query: sql, params: params.map((value) => (value == null ? null : String(value))) }),
  });
  if (!response.ok) throw dbError(response.status, await response.text());
  const data = await response.json();
  const names = (data.fields || []).map((field) => field.name);
  return {
    rows: (data.rows || []).map((row) => Object.fromEntries(row.map((value, index) => [names[index], value]))),
    rowCount: Number(data.rowCount || 0),
  };
}

// Constraint violations are part of the contract, not just a failure: callers
// translate a username collision into a user-facing conflict, so the Postgres
// error identity has to survive the HTTP hop.
function dbError(status, text) {
  let detail = {};
  try { detail = JSON.parse(text) || {}; } catch {}
  return Object.assign(new Error(`Database query failed (${status}): ${text}`), {
    pgCode: detail.code ? String(detail.code) : null,
    pgConstraint: detail.constraint ? String(detail.constraint) : null,
  });
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function secret() {
  const result = await query("SELECT value FROM settings WHERE key='player_secret'");
  if (!result.rows[0]?.value) throw new Error('Player token secret unavailable.');
  return result.rows[0].value;
}

async function signingKey() {
  if(signingKeyCache.key&&Date.now()-signingKeyCache.at<60000)return signingKeyCache.key;
  const key=await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(await secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign','verify'],
  );
  signingKeyCache={at:Date.now(),key};return key;
}
async function signature(id) {
  return base64Url(await crypto.subtle.sign('HMAC', await signingKey(), new TextEncoder().encode(id)));
}

async function tokenFor(id) {
  return `${TOKEN_PREFIX}${id}.${await signature(id)}`;
}

async function verifyToken(value) {
  const raw = String(value || '');
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const [id, supplied] = raw.slice(TOKEN_PREFIX.length).split('.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '') || !/^[A-Za-z0-9_-]{43}$/.test(supplied||'')) return null;
  return await crypto.subtle.verify('HMAC',await signingKey(),Buffer.from(supplied,'base64url'),new TextEncoder().encode(id))?id:null;
}

async function player(request, required = true) {
  const header = request.headers.get('authorization') || '';
  let id = await verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if(id&&await deletedPlayerTombstone(query,id))id=null;
  if (required && !id) throw Object.assign(new Error('Player session required.'), { status: 401 });
  return id;
}

// A browser nickname must never overwrite an owned username: the client replays
// whatever localStorage holds, so an established account would otherwise have
// its public identity replaced by a stale name, or collide with the owner of it.
async function upsertPlayer(id, name) {
  const displayName = normalizeName(name || PLACEHOLDER_USERNAME);
  const result = await query(
    `INSERT INTO players(id,display_name) VALUES($1::uuid,$2)
     ON CONFLICT(id) DO UPDATE SET
       display_name=CASE WHEN players.username_owned THEN players.display_name ELSE EXCLUDED.display_name END,
       updated_at=now()
     RETURNING display_name`,
    [id, displayName],
  );
  return result.rows[0]?.display_name || displayName;
}

// Claiming an account makes the name this browser was already using a real
// identity, but only when nobody owns it yet. A taken name is left unowned so
// linking always succeeds; the player then has to rename to publish a profile.
async function reserveUsername(playerId) {
  try {
    await query(
      `UPDATE players p SET username_owned=true,updated_at=now()
       WHERE p.id=$1::uuid
         AND NOT p.username_owned
         AND pack1_username_key(p.display_name) <> pack1_username_key($2)
         AND NOT EXISTS (
           SELECT 1 FROM players other
           WHERE other.id <> p.id AND other.username_owned
             AND pack1_username_key(other.display_name)=pack1_username_key(p.display_name)
         )`,
      [playerId, PLACEHOLDER_USERNAME],
    );
  } catch (error) {
    // A concurrent claim of the same name is the expected loss here, and it
    // must not fail the account link that is already committed.
    if (!isUsernameConflict(error)) throw error;
  }
}

async function authSession(request,options={}) {
  return accountSession(request,query,options);
}

async function neonAuth(path,{method='GET',body}={}) {
  const response=await fetch(NEON_AUTH_BASE+path,{
    method,
    headers:{origin:ACCOUNT_CONFIG.providerOrigin,...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(data.message||data.error||`Account request failed (${response.status}).`),{status:response.status,providerCode:data.code||null});
  return data;
}

function providerCookie(response,fallback='') {
  const raw=String(response.headers.get('set-cookie')||'');
  const first=raw.split(/,(?=\s*[^;,]+=)/)[0]?.split(';')[0]?.trim();
  return first||fallback;
}

async function neonAuthSession(path,{method='POST',body,cookie=''}={}) {
  const response=await fetch(NEON_AUTH_BASE+path,{
    method,
    headers:{
      origin:ACCOUNT_CONFIG.providerOrigin,
      accept:'application/json',
      ...(body===undefined?{}:{'content-type':'application/json'}),
      ...(cookie?{cookie}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(data.message||data.error||`Account request failed (${response.status}).`),{
    status:response.status,providerCode:data.code||null,providerCookie:providerCookie(response,cookie),
  });
  return {data,cookie:providerCookie(response,cookie)};
}

function authIdentity(data) {
  const token=data?.token||data?.session?.token;
  const user=data?.user;
  if(!token||!user?.id)return null;
  return {token,user,user_id:user.id,email:user.email||null,name:user.name||null};
}

async function establishAccount(data,{replaceHash=null}={}) {
  const auth=authIdentity(data);
  if(!auth)return null;
  const session=await issueAccountSession(query,auth,{replaceHash});
  await consumeNeonSession(query,auth.token);
  return {auth,session};
}

function accountJson(auth,session,status=200) {
  const response=json({user:{id:auth.user_id,email:auth.email,name:auth.name},session:{expiresAt:session.expiresAt}},status);
  return withAccountCookies(response,session);
}

function props(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  const allowed=new Set(['mode','set','seed','daily','challenge','outcome','score','grade','period','type','round','surface','method','context','kind','own','public','achievement','environments','total','percentile','source','account','run_id','session_id','target_score','opponent_score','card','affiliate']);
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (!allowed.has(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof item) || item == null) {
      output[key] = typeof item === 'string' ? item.slice(0, 240) : item;
    }
  }
  return output;
}

function mode(value) {
  if (!['top3', 'full', 'draft_run'].includes(value)) {
    throw Object.assign(new Error('Invalid mode.'), { status: 400 });
  }
  return value;
}

function setId(value) {
  const cleaned = String(value || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(cleaned)) throw Object.assign(new Error('Invalid set.'), { status: 400 });
  return cleaned;
}


function previousDateKey(dateKey, days = 1) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function computeStreak(dateKeys, todayKey = gameDateKey()) {
  const completed = new Set((dateKeys || []).filter(Boolean));
  if (!completed.size) return 0;
  const start = completed.has(todayKey) ? todayKey : previousDateKey(todayKey);
  if (!completed.has(start)) return 0;
  let streak = 0;
  let cursor = start;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = previousDateKey(cursor);
  }
  return streak;
}

async function loadCatalog() {
  if (catalogCache.data && Date.now() - catalogCache.at < 5 * 60 * 1000) return catalogCache.data;
  try {
    const response = await fetch(`${STATIC_ORIGIN}/data/catalog.json`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
    const data = await response.json();
    catalogCache = { at: Date.now(), data };
    return data;
  } catch {
    return { sets: [] };
  }
}

function countAchievement(id, label, description, current, target) {
  const safeCurrent = Math.max(0, num(current));
  const safeTarget = Math.max(1, num(target, 1));
  return {
    id,
    label,
    description,
    unlocked: safeCurrent >= safeTarget,
    current: Math.min(safeCurrent, safeTarget),
    target: safeTarget,
    progress_text: `${Math.min(safeCurrent, safeTarget)}/${safeTarget}`,
  };
}

function flagAchievement(id, label, description, unlocked, progressText = '') {
  return {
    id,
    label,
    description,
    unlocked: Boolean(unlocked),
    current: unlocked ? 1 : 0,
    target: 1,
    progress_text: progressText || (unlocked ? 'Unlocked' : 'Locked'),
  };
}

function buildAchievements({ summary, bySet, byMode, streak, dailyHistory, environmentTotal }) {
  const games = num(summary.games);
  const environmentsPlayed = num(summary.environments_played);
  const bestScore = num(summary.best_score);
  const challengeWins = num(summary.challenge_wins);
  const cube = bySet.find((row) => row.set_id === 'powered-cube');
  const draftRun = byMode.find((row) => row.mode === 'draft_run');
  const finalizedPercentiles = dailyHistory.filter(row=>row.final!==false).map((row) => num(row.percentile, 0)).filter((value) => value > 0);
  const bestPercentile = finalizedPercentiles.length ? Math.min(...finalizedPercentiles) : null;
  const topTenFinishes = finalizedPercentiles.filter((value) => value <= 10).length;
  const specialist = [...bySet].filter((row) => num(row.games) >= 5)
    .sort((a,b)=>num(b.average_score)-num(a.average_score)||num(b.games)-num(a.games))[0] || null;
  const specialistUnlocked = Boolean(specialist && num(specialist.average_score) >= 85);
  const specialistProgress = specialist
    ? `${String(specialist.set_id || '').toUpperCase()} · ${num(specialist.average_score).toFixed(1)} avg over ${num(specialist.games)} appearances`
    : '5 appearances · 85+ average';
  const archiveComplete = environmentTotal > 0
    ? countAchievement('archive_complete', 'Archive Complete', 'Play every environment currently available in Pack One.', environmentsPlayed, environmentTotal)
    : flagAchievement('archive_complete', 'Archive Complete', 'Play every environment currently available in Pack One.', false, 'Catalog temporarily unavailable');

  return [
    countAchievement('first', 'First Pack', 'Complete your first scored Pack One game.', games, 1),
    countAchievement('ten_games', 'Settling In', 'Complete 10 scored games.', games, 10),
    countAchievement('fifty_games', 'Draft Regular', 'Complete 50 scored games.', games, 50),
    countAchievement('hundred_games', 'Century', 'Complete 100 scored games.', games, 100),
    countAchievement('first_run','First Draft Run','Finish all eight decisions in a Draft Run.',num(draftRun?.games),1),
    countAchievement('ten_runs','Ten Runs','Finish ten Draft Runs.',num(draftRun?.games),10),
    flagAchievement('run_specialist','Draft Run Specialist','Average 80+ across at least 20 Draft Runs.',num(draftRun?.games)>=20&&num(draftRun?.average_score)>=80,`${Math.min(num(draftRun?.games),20)}/20 runs · ${num(draftRun?.average_score).toFixed(1)} avg`),
    flagAchievement('set_specialist','Set Specialist','Average 85+ across at least five appearances in one environment.',specialistUnlocked,specialistProgress),
    flagAchievement('perfect', 'Perfect 100', 'Post a 100-point result.', bestScore >= 100, `${bestScore}/100 best`),
    countAchievement('streak3', 'Three in a Row', 'Complete ranked Daily Challenges on three consecutive game days.', streak, 3),
    countAchievement('streak7', 'One-Week Heater', 'Reach a seven-day Daily streak.', streak, 7),
    countAchievement('streak30', 'Daily Ritual', 'Reach a 30-day Daily streak.', streak, 30),
    countAchievement('explorer5', 'Archive Explorer', 'Play five different environments.', environmentsPlayed, 5),
    countAchievement('explorer10', 'Format Traveler', 'Play ten different environments.', environmentsPlayed, 10),
    countAchievement('explorer20', 'Deep Archive', 'Play twenty different environments.', environmentsPlayed, 20),
    archiveComplete,
    countAchievement('cube_first', 'Power Nine', 'Complete a Powered Cube Pack Run.', num(cube?.games), 1),
    countAchievement('cube_ten', 'Cube Regular', 'Complete ten Powered Cube Pack Runs.', num(cube?.games), 10),
    countAchievement('challenge5', 'Five Up', 'Win five friend challenges.', challengeWins, 5),
    countAchievement('challenge25', 'Table Captain', 'Win twenty-five friend challenges.', challengeWins, 25),
    flagAchievement('top25', 'Top Quarter', 'Finish in the top 25% of a Daily leaderboard with at least 10 players.', bestPercentile != null && bestPercentile <= 25, bestPercentile ? `Top ${bestPercentile}% best` : 'No qualifying Daily yet'),
    flagAchievement('top10', 'Top Ten Percent', 'Finish in the top 10% of a Daily leaderboard with at least 10 players.', bestPercentile != null && bestPercentile <= 10, bestPercentile ? `Top ${bestPercentile}% best` : 'No qualifying Daily yet'),
    countAchievement('top10_repeat','Repeat Contender','Finish in the top 10% on three finalized Daily leaderboards with at least 10 players.',topTenFinishes,3),
    flagAchievement('top1', 'One Percent', 'Finish in the top 1% of a Daily leaderboard with at least 10 players.', bestPercentile === 1, bestPercentile ? `Top ${bestPercentile}% best` : 'No qualifying Daily yet'),
  ];
}

async function dailyHistoryFor(playerId) {
  const result = await query(
    `WITH mine AS (
       SELECT challenge_date,set_id,mode,score,grade,created_at
       FROM scores
       WHERE player_id=$1::uuid
     )
     SELECT m.challenge_date::text date,m.set_id,m.mode,m.score,m.grade,m.created_at,
            b.total,b.rank,b.through_ties
     FROM mine m
     CROSS JOIN LATERAL (
       SELECT count(*) total,1+count(*) FILTER(WHERE x.score>m.score) rank,
              count(*) FILTER(WHERE x.score>=m.score) through_ties
       FROM scores x WHERE x.challenge_date=m.challenge_date AND x.set_id=m.set_id AND x.mode=m.mode
     ) b
     ORDER BY m.challenge_date DESC,m.created_at DESC`,
    [playerId],
  );
  return result.rows.map((row) => {
    const total = num(row.total);
    const rank = num(row.rank, 1);
    return {
      date: row.date,
      set_id: row.set_id,
      mode: row.mode,
      score: num(row.score),
      grade: row.grade,
      rank,
      total,
      percentile: total >= 10 ? Math.max(1, Math.ceil((num(row.through_ties) / total) * 100)) : null,
      final: row.date < gameDateKey(),
    };
  });
}

async function profileMetaByPlayer(playerId) {
  const result = await query(
    `SELECT p.display_name,p.profile_key,p.profile_public,p.favorite_set_id,p.showcase_achievement,p.username_owned,
            EXISTS(SELECT 1 FROM account_links a WHERE a.player_id=p.id) claimed
     FROM players p
     WHERE p.id=$1::uuid
     LIMIT 1`,
    [playerId],
  );
  return result.rows[0] || null;
}

async function profileMetaByKey(profileKey) {
  const result = await query(
    `SELECT p.id::text player_id,p.display_name,p.profile_key,p.profile_public,p.favorite_set_id,p.showcase_achievement
     FROM players p
     WHERE p.profile_key=$1 AND p.profile_public=true
     LIMIT 1`,
    [profileKey],
  );
  return result.rows[0] || null;
}

async function buildProfile(playerId, meta, { own = false } = {}) {
  const [summaryResult, bySetResult, byModeResult, recentResult, dailyHistory, catalog, streakDates] = await Promise.all([
    query(
      `SELECT count(*) games,round(avg(score),1) average_score,max(score) best_score,
              count(*) FILTER (WHERE outcome='win') challenge_wins,
              count(*) FILTER (WHERE outcome='loss') challenge_losses,
              count(*) FILTER (WHERE outcome='tie') challenge_ties,
              count(*) FILTER (WHERE is_daily) daily_games,
              count(DISTINCT set_id) environments_played
       FROM game_results WHERE player_id=$1::uuid`,
      [playerId],
    ),
    query(
      `WITH environment_results AS (
         SELECT g.id,g.played_at,g.is_daily,e.set_id,e.score
         FROM game_results g JOIN LATERAL (
           SELECT e.set_id,e.score FROM game_result_environments e WHERE e.game_result_id=g.id
           UNION ALL SELECT g.set_id,g.score WHERE g.mode<>'draft_run'
         ) e ON true WHERE g.player_id=$1::uuid
       ) SELECT set_id,count(*) games,round(avg(score),1) average_score,max(score) best_score,
              count(*) FILTER (WHERE is_daily) daily_games,max(played_at) last_played_at
       FROM environment_results
       GROUP BY set_id
       ORDER BY games DESC,set_id`,
      [playerId],
    ),
    query(
      `SELECT CASE WHEN set_id='powered-cube' THEN 'cube' ELSE mode END mode,count(*) games,round(avg(score),1) average_score,max(score) best_score
       FROM game_results
       WHERE player_id=$1::uuid
       GROUP BY CASE WHEN set_id='powered-cube' THEN 'cube' ELSE mode END
       ORDER BY mode`,
      [playerId],
    ),
    query(
      `SELECT id::text cursor,played_at,set_id,mode,score,grade,is_daily,outcome
       FROM game_results
       WHERE player_id=$1::uuid
       ORDER BY id DESC
       LIMIT 30`,
      [playerId],
    ),
    dailyHistoryFor(playerId),
    loadCatalog(),
    query('SELECT DISTINCT challenge_date::text date FROM scores WHERE player_id=$1::uuid ORDER BY date',[playerId]),
  ]);

  const summary = summaryResult.rows[0] || {};
  const bySet = bySetResult.rows.map((row) => ({
    set_id: row.set_id,
    games: num(row.games),
    average_score: num(row.average_score),
    best_score: num(row.best_score),
    daily_games: num(row.daily_games),
    last_played_at: row.last_played_at,
  }));
  const byMode = byModeResult.rows.map((row) => ({
    mode: row.mode,
    games: num(row.games),
    average_score: num(row.average_score),
    best_score: num(row.best_score),
  }));
  const recent = recentResult.rows.map((row) => ({
    cursor: row.cursor,
    played_at: row.played_at,
    set_id: row.set_id,
    mode: row.mode,
    score: num(row.score),
    grade: row.grade,
    is_daily: bool(row.is_daily),
    outcome: row.outcome || null,
  }));
  const dates = streakDates.rows.map(row=>row.date);
  const streak = computeStreak(dates);
  let longestStreak=0,chain=0,previous=null;
  for(const date of dates){chain=previous===previousDateKey(date)?chain+1:1;longestStreak=Math.max(longestStreak,chain);previous=date;}
  const catalogSets = (catalog.sets || []).filter((entry) => entry?.id && !entry.is_fixture);
  const environmentTotal = catalogSets.length;
  const reportedEnvironmentTotal = environmentTotal || Math.max(num(summary.environments_played), 0);
  const normalizedSummary = {
    games: num(summary.games),
    average_score: num(summary.average_score),
    best_score: num(summary.best_score),
    challenge_wins: num(summary.challenge_wins),
    challenge_losses: num(summary.challenge_losses),
    challenge_ties: num(summary.challenge_ties),
    daily_games: num(summary.daily_games),
    environments_played: bySet.filter(row=>catalogSets.some(set=>set.id===row.set_id)).length,
    current_streak: streak,
    best_streak:longestStreak,
  };
  const achievements = buildAchievements({
    summary: normalizedSummary,
    bySet,
    byMode,
    streak:longestStreak,
    dailyHistory,
    environmentTotal,
  });
  const newlyEarned=achievements.filter(a=>a.unlocked).map(a=>a.id);
  if(newlyEarned.length) await query(`WITH earned AS (
    INSERT INTO player_achievements(player_id,achievement_id) SELECT $1::uuid,value FROM jsonb_array_elements_text($2::jsonb)
    ON CONFLICT DO NOTHING RETURNING achievement_id
  ) INSERT INTO analytics_events(player_id,event_name,event_props)
    SELECT $1::uuid,n.name,jsonb_build_object('achievement',achievement_id) FROM earned
    CROSS JOIN LATERAL (SELECT 'achievement_unlocked' name UNION ALL
      SELECT CASE WHEN achievement_id LIKE 'streak%' THEN 'streak_milestone_reached' ELSE 'archive_milestone_reached' END
      WHERE achievement_id LIKE 'streak%' OR achievement_id LIKE 'explorer%' OR achievement_id='archive_complete') n`,[playerId,JSON.stringify(newlyEarned)]);
  const earned=await query('SELECT achievement_id,earned_at FROM player_achievements WHERE player_id=$1::uuid',[playerId]);
  for(const a of achievements){const saved=earned.rows.find(r=>r.achievement_id===a.id);if(saved){a.unlocked=true;a.earned_at=saved.earned_at;a.current=a.target;a.progress_text='Unlocked';}}
  const bestEnvironments = bySet
    .filter((row) => row.games >= 3)
    .sort((a, b) => b.average_score - a.average_score || b.games - a.games || a.set_id.localeCompare(b.set_id))
    .slice(0, 5);
  const cube = bySet.find((row) => row.set_id === 'powered-cube') || null;
  const finalPercentiles=dailyHistory.filter(r=>r.final&&r.percentile).map(r=>r.percentile);

  return {
    player: {
      display_name: meta.display_name,
      profile_key: meta.profile_key,
      profile_public: bool(meta.profile_public),
      favorite_set_id: meta.favorite_set_id || null,
      showcase_achievement: meta.showcase_achievement || null,
      ...(own ? { claimed: bool(meta.claimed), username_owned: bool(meta.username_owned) } : {}),
    },
    summary: normalizedSummary,
    environment_total: reportedEnvironmentTotal,
    by_set: bySet,
    by_mode: byMode,
    best_environments: bestEnvironments,
    cube,
    best_final_percentile: finalPercentiles.length?Math.min(...finalPercentiles):null,
    daily_history: dailyHistory.slice(0,120),
    recent,
    trend: [...recent].slice(0, 40).reverse().map((row) => ({
      played_at: row.played_at,
      score: row.score,
      set_id: row.set_id,
      mode: row.mode,
    })),
    achievements,
  };
}

async function historyPage(playerId, cursor, limit = 25) {
  const safeLimit = Math.max(5, Math.min(50, num(limit, 25)));
  const safeCursor = /^\d+$/.test(String(cursor || '')) ? String(cursor) : null;
  const result = safeCursor
    ? await query(
      `SELECT id::text cursor,played_at,set_id,mode,score,grade,is_daily,outcome
       FROM game_results
       WHERE player_id=$1::uuid AND id<$2::bigint
       ORDER BY id DESC LIMIT $3::int`,
      [playerId, safeCursor, safeLimit],
    )
    : await query(
      `SELECT id::text cursor,played_at,set_id,mode,score,grade,is_daily,outcome
       FROM game_results
       WHERE player_id=$1::uuid
       ORDER BY id DESC LIMIT $2::int`,
      [playerId, safeLimit],
    );
  const rows = result.rows.map((row) => ({
    cursor: row.cursor,
    played_at: row.played_at,
    set_id: row.set_id,
    mode: row.mode,
    score: num(row.score),
    grade: row.grade,
    is_daily: bool(row.is_daily),
    outcome: row.outcome || null,
  }));
  return { rows, next_cursor: rows.length === safeLimit ? rows.at(-1)?.cursor || null : null };
}

async function handleBrowserPlayerSession(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const current=await player(request,false);
  if(current) {
    const meta=await profileMetaByPlayer(current);
    return json({ok:true,playerId:current,displayName:meta?.display_name||'Pack Player',profileKey:meta?.profile_key||null});
  }
  const payload=await readJson(request);
  const id=crypto.randomUUID(),token=await tokenFor(id);
  const displayName=await upsertPlayer(id,payload.displayName||'Pack Player');
  const meta=await profileMetaByPlayer(id);
  return withPlayerCookie(json({ok:true,playerId:id,displayName,profileKey:meta?.profile_key||null},201),token);
}

async function handlePlayerMigration(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const legacy=String(request.headers.get('x-pack1-player-session')||'');
  const id=await verifyToken(legacy);
  if(!id)throw Object.assign(Error('Guest session could not be migrated.'),{status:401});
  const meta=await profileMetaByPlayer(id);
  if(!meta)throw Object.assign(Error('Guest record could not be migrated.'),{status:401});
  // Migration seeds a browser that has no first-party player yet. An already
  // established cookie may be the player an account is linked to, so a stray
  // legacy bearer must never replace it - that swap breaks the account link.
  const current=await player(request,false);
  if(current&&current!==id) {
    const established=await profileMetaByPlayer(current);
    if(established)return json({ok:true,playerId:current,displayName:established.display_name,profileKey:established.profile_key||null,migrated:false});
  }
  return withPlayerCookie(json({ok:true,playerId:id,displayName:meta.display_name,profileKey:meta.profile_key||null,migrated:true}),legacy);
}

async function handleAccountSignup(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const payload=await readJson(request);
  const data=await neonAuth('/sign-up/email',{method:'POST',body:{
    name:String(payload.name||'').trim().slice(0,80),
    email:String(payload.email||'').trim(),
    password:String(payload.password||''),
    callbackURL:ACCOUNT_RETURN+'?auth=verify',
  }});
  const established=await establishAccount(data);
  if(!established)return json({ok:true,verificationRequired:true,user:data?.user||null},202);
  return accountJson(established.auth,established.session,201);
}

async function handleAccountSignin(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const payload=await readJson(request);
  const data=await neonAuth('/sign-in/email',{method:'POST',body:{
    email:String(payload.email||'').trim(),
    password:String(payload.password||''),
    rememberMe:true,
  }});
  const established=await establishAccount(data);
  if(!established)throw Object.assign(Error('Sign in did not create an account session.'),{status:502});
  return accountJson(established.auth,established.session);
}

const RESET_REQUEST_MESSAGE="If an account exists for that email, we've sent a password reset link.";
const RESET_LIMIT_MAX=5;

function normalizedRecoveryEmail(value) {
  const email=String(value||'').trim().toLowerCase();
  if(email.length<3||email.length>254||!email.includes('@'))throw Object.assign(Error('Enter a valid email address.'),{status:400});
  return email;
}

function recoveryRateKey(email) {
  const secret=String(process.env.PACK1_RATE_LIMIT_SECRET||'');
  if(secret.length<32)throw Object.assign(Error('Password recovery is temporarily unavailable.'),{status:503,code:'RATE_LIMIT_CONFIG'});
  return createHmac('sha256',secret).update(email).digest('hex');
}

async function consumeRecoveryLimit(email) {
  const key=recoveryRateKey(email);
  await query('DELETE FROM account_recovery_rate_limits WHERE expires_at<=now()');
  const result=await query(`INSERT INTO account_recovery_rate_limits(limit_key,attempts,expires_at)
    VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(limit_key) DO UPDATE SET
      attempts=CASE WHEN account_recovery_rate_limits.expires_at<=now() THEN 1 ELSE account_recovery_rate_limits.attempts+1 END,
      expires_at=CASE WHEN account_recovery_rate_limits.expires_at<=now() THEN now()+interval '15 minutes' ELSE account_recovery_rate_limits.expires_at END
    RETURNING attempts,expires_at`,[key]);
  return {limited:Number(result.rows[0]?.attempts||0)>RESET_LIMIT_MAX,expiresAt:result.rows[0]?.expires_at,key};
}

async function handlePasswordResetRequest(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const payload=await readJson(request);
  const email=normalizedRecoveryEmail(payload.email);
  const limit=await consumeRecoveryLimit(email);
  if(limit.limited)return json({error:'Too many password reset requests. Please try again later.'},429);
  try {
    await neonAuth('/request-password-reset',{method:'POST',body:{
      email,
      redirectTo:ACCOUNT_CONFIG.resetDestination,
    }});
  } catch(error) {
    if(Number(error?.status||500)>=500)throw Object.assign(Error('Password recovery is temporarily unavailable.'),{status:503});
    // Better Auth account/provider-specific 4xx responses are intentionally
    // collapsed to the same public response as a successful request.
  }
  return json({ok:true,message:RESET_REQUEST_MESSAGE});
}

const VERIFICATION_REQUEST_MESSAGE="If an unverified account exists for that email, we've sent a verification link.";

async function consumeVerificationLimit(email) {
  const key=recoveryRateKey('verification:'+email);
  await query('DELETE FROM account_recovery_rate_limits WHERE expires_at<=now()');
  const result=await query(`INSERT INTO account_recovery_rate_limits(limit_key,attempts,expires_at)
    VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(limit_key) DO UPDATE SET
      attempts=CASE WHEN account_recovery_rate_limits.expires_at<=now() THEN 1 ELSE account_recovery_rate_limits.attempts+1 END,
      expires_at=CASE WHEN account_recovery_rate_limits.expires_at<=now() THEN now()+interval '15 minutes' ELSE account_recovery_rate_limits.expires_at END
    RETURNING attempts,expires_at`,[key]);
  return {limited:Number(result.rows[0]?.attempts||0)>RESET_LIMIT_MAX,expiresAt:result.rows[0]?.expires_at,key};
}

async function handleVerificationEmailRequest(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const payload=await readJson(request);
  const email=normalizedRecoveryEmail(payload.email);
  const limit=await consumeVerificationLimit(email);
  if(limit.limited)return json({error:'Too many verification email requests. Please try again later.'},429);
  try {
    await neonAuth('/send-verification-email',{method:'POST',body:{
      email,
      callbackURL:ACCOUNT_RETURN+'?auth=verify',
    }});
  } catch(error) {
    if(Number(error?.status||500)>=500)throw Object.assign(Error('Email verification is temporarily unavailable.'),{status:503});
    // Provider/account-specific 4xx responses are intentionally collapsed so
    // this public endpoint does not reveal whether an address has an account.
  }
  return json({ok:true,message:VERIFICATION_REQUEST_MESSAGE});
}

function recoveryToken(value) {
  const token=String(value||'');
  if(!/^[A-Za-z0-9._~-]{16,2048}$/.test(token))throw Object.assign(Error('This password reset link is invalid or expired.'),{status:400,code:'INVALID_RESET'});
  return token;
}

async function recoveryUserForToken(token) {
  const result=await query(`SELECT value auth_user_id,"expiresAt" expires_at FROM neon_auth.verification
    WHERE identifier=$1 LIMIT 1`,['reset-password:'+token]);
  const row=result.rows[0],id=String(row?.auth_user_id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw Object.assign(Error('This password reset link is invalid or has already been used.'),{status:400,code:'INVALID_RESET'});
  if(new Date(row.expires_at).getTime()<=Date.now())
    throw Object.assign(Error('This password reset link has expired.'),{status:400,code:'EXPIRED_RESET'});
  return id;
}

async function handlePasswordReset(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const payload=await readJson(request);
  const token=recoveryToken(payload.token);
  const password=String(payload.newPassword||'');
  if(password.length<8||password.length>128)throw Object.assign(Error('Password must be 8-128 characters.'),{status:400,code:'PASSWORD_POLICY'});
  // Resolve only a tentative identity before provider consumption. No Pack One
  // session is touched unless Better Auth subsequently confirms the reset.
  const authUserId=await recoveryUserForToken(token);
  try {
    await neonAuth('/reset-password',{method:'POST',body:{newPassword:password,token}});
  } catch(error) {
    const status=Number(error?.status||500);
    if(status>=500)throw Object.assign(Error('Password recovery is temporarily unavailable.'),{status:503,code:'PROVIDER_FAILURE'});
    throw Object.assign(Error(status===400?'This password reset link is invalid, expired, or already used.':'The new password was not accepted.'),{status:400,code:status===400?'INVALID_RESET':'PASSWORD_POLICY'});
  }
  await revokeAllAccountSessions(query,authUserId);
  return clearAccountCookies(json({ok:true}));
}

async function handleAccountMigration(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  await player(request);
  const legacy=await authSession(request,{allowLegacy:true,csrf:false});
  if(legacy.source!=='legacy') {
    const current=legacy.source==='cookie'?legacy:await authSession(request);
    return json({ok:true,user:{id:current.user_id,email:current.email,name:current.name},migrated:false});
  }
  const session=await issueAccountSession(query,legacy);
  await consumeNeonSession(query,legacy.token);
  return withAccountCookies(json({ok:true,user:{id:legacy.user_id,email:legacy.email,name:legacy.name},migrated:true}),session);
}

async function handleGoogleCallback(request) {
  const url=new URL(request.url);
  const verifier=String(url.searchParams.get('neon_auth_session_verifier')||'');
  if(!/^[A-Za-z0-9._~-]{16,2048}$/.test(verifier))
    return new Response(null,{status:302,headers:{location:ACCOUNT_RETURN+'?auth=google-error','cache-control':'no-store'}});
  try {
    const data=await neonAuth('/get-session?neon_auth_session_verifier='+encodeURIComponent(verifier));
    const established=await establishAccount(data);
    if(!established)throw Error('Google sign in did not create a session.');
    return withAccountCookies(new Response(null,{status:302,headers:{location:ACCOUNT_RETURN+'?auth=google','cache-control':'no-store'}}),established.session);
  } catch(error) {
    console.error('Google OAuth callback failed',Number(error?.status||500));
    return new Response(null,{status:302,headers:{location:ACCOUNT_RETURN+'?auth=google-error','cache-control':'no-store'}});
  }
}

async function handleSession(request) {
  const payload = await readJson(request);
  const id = crypto.randomUUID();
  const token = await tokenFor(id);
  const displayName = await upsertPlayer(id, payload.displayName || 'Pack Player');
  const meta = await profileMetaByPlayer(id);
  return json({ token, playerId: id, displayName, profileKey: meta?.profile_key || null });
}

const SERVER_EVENTS=new Set(['account_claimed','username_ownership_conflict','public_profile_enabled','leaderboard_name_changed','achievement_unlocked','archive_milestone_reached','streak_milestone_reached','game_started','daily_started','game_completed','elite_activated']);
async function handleEvents(request) {
  const id = await player(request);
  const payload = await readJson(request);
  const events = (Array.isArray(payload.events) ? payload.events : [payload]).slice(0, 20);
  const clean=[];
  for (const event of events) {
    const name = String(event?.name || '').trim().slice(0, 64);
    if (!/^[a-z0-9_.-]{2,64}$/i.test(name) || SERVER_EVENTS.has(name.toLowerCase())) continue;
    clean.push({name,props:props(event.props)});
  }
  if(clean.length)await consumePlayerLimit(query,id,'events',{limit:300,seconds:60,cost:clean.length});
  if(clean.length)await query('INSERT INTO analytics_events(player_id,event_name,event_props) SELECT $1::uuid,e.name,e.props FROM jsonb_to_recordset($2::jsonb) e(name text,props jsonb)',[id,JSON.stringify(clean)]);
  return json({ ok: true, accepted:clean.length });
}

async function handleResult(request) {
  const id = await player(request);
  const payload = await readJson(request);
  if(payload.mode==='draft_run') throw Object.assign(new Error('Draft Run results are saved by the game server.'),{status:403});
  const score = Math.max(0, Math.min(100, Math.round(Number(payload.score))));
  if (!Number.isFinite(score)) throw Object.assign(new Error('Invalid score.'), { status: 400 });
  const resultId = String(payload.clientResultId || '').slice(0, 80);
  if (!/^[a-zA-Z0-9:_-]{6,80}$/.test(resultId)) {
    throw Object.assign(new Error('Invalid result id.'), { status: 400 });
  }
  await consumePlayerLimit(query,id,'results',{limit:60,seconds:600});
  const outcome = ['win', 'tie', 'loss'].includes(payload.outcome) ? payload.outcome : null;
  await query(
    `INSERT INTO game_results(player_id,set_id,mode,score,grade,seed,is_daily,challenge_id,opponent_name,opponent_score,outcome,client_result_id)
     VALUES($1::uuid,$2,$3,$4::int,$5,$6,$7::boolean,$8,$9,$10::int,$11,$12)
     ON CONFLICT(player_id,client_result_id) DO NOTHING`,
    [
      id,
      setId(payload.setId),
      mode(payload.mode),
      score,
      String(payload.grade || '').slice(0, 12),
      String(payload.seed || '').slice(0, 80) || null,
      Boolean(payload.isDaily),
      String(payload.challengeId || '').slice(0, 40) || null,
      String(payload.opponentName || '').slice(0, 80) || null,
      Number.isFinite(Number(payload.opponentScore)) ? Number(payload.opponentScore) : null,
      outcome,
      resultId,
    ],
  );
  return json({ ok: true });
}

async function handleStats(request) {
  const id = await player(request);
  const [summary, bySet, byMode, recent] = await Promise.all([
    query(
      `SELECT count(*) games,round(avg(score),1) average_score,max(score) best_score,
              count(*) FILTER (WHERE outcome='win') challenge_wins,
              count(*) FILTER (WHERE outcome='loss') challenge_losses,
              count(*) FILTER (WHERE outcome='tie') challenge_ties
       FROM game_results WHERE player_id=$1::uuid`,
      [id],
    ),
    query(
      `SELECT set_id,count(*) games,round(avg(score),1) average_score,max(score) best_score
       FROM game_results WHERE player_id=$1::uuid GROUP BY set_id ORDER BY games DESC,set_id`,
      [id],
    ),
    query(
      `SELECT mode,count(*) games,round(avg(score),1) average_score,max(score) best_score
       FROM game_results WHERE player_id=$1::uuid GROUP BY mode ORDER BY mode`,
      [id],
    ),
    query(
      `SELECT played_at,set_id,mode,score,grade,is_daily,challenge_id,opponent_name,opponent_score,outcome,seed,client_result_id
       FROM game_results WHERE player_id=$1::uuid ORDER BY played_at DESC LIMIT 50`,
      [id],
    ),
  ]);
  return json({ summary: summary.rows[0] || {}, bySet: bySet.rows, byMode: byMode.rows, recent: recent.rows });
}

async function validateDailyRunScore(runId, playerId, authUserId) {
  const result = await query(
    `WITH identity_allowed AS MATERIALIZED (
      SELECT 1 WHERE pack1_identity_attachment_allowed($3::uuid)
    ), candidate AS MATERIALIZED (
       SELECT s.*
       FROM draft_run_sessions s
       WHERE s.id=$1::uuid AND s.player_id=$2::uuid AND s.day=$4::date
         AND EXISTS(SELECT 1 FROM identity_allowed)
         AND EXISTS(SELECT 1 FROM players p WHERE p.id=s.player_id AND p.username_owned=true)
         AND s.score IS NOT NULL AND NOT s.leaderboard_eligible
         AND jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids)
         AND NOT EXISTS (
           SELECT 1 FROM scores x
           WHERE x.player_id=s.player_id AND x.challenge_date=s.day
             AND x.set_id=s.environment AND x.mode='draft_run'
         )
       FOR UPDATE
     ), ranked AS (
       INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json,is_featured)
       SELECT c.player_id,c.day,c.environment,'draft_run',c.score,
              CASE WHEN c.score>=90 THEN 'A' WHEN c.score>=80 THEN 'B' WHEN c.score>=65 THEN 'C' WHEN c.score>=50 THEN 'D' ELSE 'F' END,
              COALESCE((SELECT jsonb_agg(a.value->>'selectedId') FROM jsonb_array_elements(c.answers) a(value)),'[]'::jsonb),
              jsonb_build_object('run',c.id,'corpus_version',c.corpus_version,'scoring_version',c.scoring_version,
                'selection_version',c.selection_version,'validated_after_sign_in',true),
              true
       FROM candidate c
       ON CONFLICT(player_id,challenge_date,set_id,mode) DO NOTHING
       RETURNING player_id
     ), promoted AS (
       UPDATE draft_run_sessions s
       SET leaderboard_eligible=true,daily_account_id=$3::uuid,updated_at=now()
       FROM candidate c
       WHERE s.id=c.id AND EXISTS(SELECT 1 FROM ranked)
       RETURNING s.id
     ), event AS (
       INSERT INTO analytics_events(player_id,event_name,event_props)
       SELECT $2::uuid,'daily_score_validated',jsonb_build_object('run_id',$1::text)
       FROM promoted
     )
     SELECT count(*) n FROM promoted`,
    [runId, playerId, authUserId, gameDateKey()],
  );
  return Number(result.rows[0]?.n || 0) > 0;
}

async function handleLink(request,{browser=false}={}) {
  const payload = await readJson(request);
  const validateDailyRunId = payload.validateDailyRunId == null ? null : String(payload.validateDailyRunId);
  if (validateDailyRunId && !DAILY_RUN_ID_RE.test(validateDailyRunId)) {
    throw Object.assign(new Error('Invalid Daily run.'), { status: 400 });
  }
  const current = await player(request);
  const auth = await authSession(request);
  const old = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid', [auth.user_id]);
  let id = old.rows[0]?.player_id || current;
  let merged = false;
  let linkChanged = !old.rows.length;

  if (!old.rows.length) {
    const claimed=await query(
      `WITH allowed AS MATERIALIZED (
          SELECT 1 WHERE pack1_identity_attachment_allowed($1::uuid)
        ), claimed AS (
          INSERT INTO account_links(auth_user_id,player_id)
          SELECT $1::uuid,$2::uuid FROM allowed
          ON CONFLICT(auth_user_id) DO NOTHING RETURNING player_id
        ), event AS (
          INSERT INTO analytics_events(player_id,event_name) SELECT player_id,'account_claimed' FROM claimed
        )
        SELECT player_id FROM claimed`,
      [auth.user_id, current],
    );
    if(!claimed.rows.length) {
      const pending=await query('SELECT 1 FROM account_deletion_operations WHERE auth_user_id=$1::uuid LIMIT 1',[auth.user_id]);
      if(pending.rows.length)throw Object.assign(Error('This account is being deleted.'),{status:409,code:'ACCOUNT_DELETING'});
    }
    const resolved = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid', [auth.user_id]);
    id = resolved.rows[0]?.player_id || current;
  }
  if (id !== current) {
    // Switching this browser back to the account's player is an association
    // change even when the current player is already linked elsewhere.
    linkChanged = true;
    const currentLink = await query('SELECT auth_user_id FROM account_links WHERE player_id=$1::uuid LIMIT 1', [current]);
    if (!currentLink.rows.length) {
      const mergedResult=await query(`WITH allowed AS MATERIALIZED (
          SELECT 1 WHERE pack1_identity_attachment_allowed($3::uuid)
        )
        SELECT merge_pack1_player($1::uuid,$2::uuid) FROM allowed`,[current,id,auth.user_id]);
      if(!mergedResult.rows.length)throw Object.assign(Error('This account is being deleted.'),{status:409,code:'ACCOUNT_DELETING'});
      merged = true;
    }
  }

  await reserveUsername(id);

  const profile = await profileMetaByPlayer(id);
  const usernameOwned=bool(profile?.username_owned);
  const rankingReason=usernameOwned?null:(isPlaceholderUsername(profile?.display_name)?'username_required':'username_taken');
  if(linkChanged&&!usernameOwned) {
    await query(
      `INSERT INTO analytics_events(player_id,event_name,event_props)
       VALUES($1::uuid,'username_ownership_conflict',jsonb_build_object('reason',$2::text))`,
      [id,rankingReason],
    );
  }
  const validatedDailyScore = validateDailyRunId
    ? await validateDailyRunScore(validateDailyRunId, id, auth.user_id)
    : false;
  const playerToken=await tokenFor(id);
  let response=json({
    ok: true,
    merged,
    validatedDailyScore,
    playerId: id,
    ...(browser?{}:{token:playerToken}),
    displayName: profile?.display_name || auth.name || 'Pack Player',
    profileKey: profile?.profile_key || null,
    email: auth.email,
    rankingIdentity:{eligible:usernameOwned,reason:rankingReason},
  });
  // No-op links must not rotate player/account cookies. Genuine claims,
  // merges, and browser-player reassociations remain rotation boundaries.
  if(browser&&linkChanged)response=withPlayerCookie(response,playerToken);
  if(auth.source==='cookie'&&linkChanged) {
    const rotated=await issueAccountSession(query,auth,{replaceHash:auth.session_hash});
    response=withAccountCookies(response,rotated);
  }
  return response;
}

async function credentialState(authUserId) {
  const result=await query(`SELECT
    bool_or("providerId"='credential' AND password IS NOT NULL) has_password,
    bool_or("providerId"='google') has_google
    FROM neon_auth.account WHERE "userId"=$1::uuid`,[authUserId]);
  return {
    password:bool(result.rows[0]?.has_password),
    google:bool(result.rows[0]?.has_google),
  };
}

async function handleAccount(request) {
  const auth = await authSession(request);
  const credentials=await credentialState(auth.user_id);
  const enabled=deletionEnabled();
  const emailMethod=enabled&&!credentials.password&&deletionEmailConfigured()&&Boolean(await deletionEmailForAuth(query,auth.user_id));
  return json({
    user: { id: auth.user_id, email: auth.email, name: auth.name },
    session: { expiresAt: auth.expires_at },
    credentials,
    deletion:{
      enabled,
      available:enabled&&credentials.password,
      googleOnly:credentials.google&&!credentials.password,
      method:enabled?(credentials.password?'password':emailMethod?'email':null):null,
    },
  });
}

const PASSWORD_FAILURE_LIMIT=8;
const PASSWORD_NETWORK_LIMIT=5;
const PASSWORD_LIMIT_SECONDS=15*60;

function credentialThrottle(message,limit) {
  return new Response(JSON.stringify({error:message,code:'RATE_LIMITED'}),{
    status:429,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'retry-after':String(Math.max(1,limit.retryAfter||1)),
    },
  });
}

async function providerPasswordSession(auth,currentPassword) {
  try {
    const signed=await neonAuthSession('/sign-in/email',{body:{
      email:String(auth.email||''),
      password:currentPassword,
      rememberMe:false,
    }});
    if(String(signed.data?.user?.id||'')!==String(auth.user_id))
      throw Object.assign(Error('Current password was not accepted.'),{status:400,code:'CURRENT_PASSWORD'});
    return signed.cookie;
  } catch(error) {
    if(Number(error?.status||500)>=500)
      throw Object.assign(Error('Password change is temporarily unavailable.'),{status:503,code:'PROVIDER_FAILURE'});
    throw Object.assign(Error('Current password was not accepted.'),{status:400,code:'CURRENT_PASSWORD'});
  }
}

async function closeProviderSession(cookie) {
  if(!cookie)return;
  try {await neonAuthSession('/sign-out',{body:{},cookie});} catch {}
}

async function handlePasswordChange(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const auth=await authSession(request,{required:true,allowLegacy:false,csrf:true});
  const payload=await readJson(request);
  const currentPassword=String(payload.currentPassword||'');
  const newPassword=String(payload.newPassword||'');
  if(currentPassword.length<1||currentPassword.length>256)
    throw Object.assign(Error('Enter your current password.'),{status:400,code:'CURRENT_PASSWORD'});
  if(newPassword.length<8||newPassword.length>128)
    throw Object.assign(Error('Password must be 8-128 characters.'),{status:400,code:'PASSWORD_POLICY'});
  if(newPassword===currentPassword)
    throw Object.assign(Error('Choose a new password that is different from your current password.'),{status:400,code:'PASSWORD_POLICY'});

  const state=await credentialState(auth.user_id);
  if(!state.password)
    throw Object.assign(Error('This account does not have a password to change.'),{status:409,code:'NO_PASSWORD_CREDENTIAL'});

  // The account-global oracle budget is independent of network configuration.
  // The trusted network dimension is resolved separately and fails closed before
  // any provider call if its authenticated gateway proof is unavailable.
  const accountLimit=await consumeCredentialLimit(query,{
    authUserId:auth.user_id,purpose:'current_password',
    limit:PASSWORD_FAILURE_LIMIT,seconds:PASSWORD_LIMIT_SECONDS,
  });
  if(accountLimit.limited)
    return credentialThrottle('Too many password attempts. Please try again later.',accountLimit);
  const network=trustedCredentialNetwork(request);
  const networkLimit=await consumeCredentialLimit(query,{
    authUserId:auth.user_id,purpose:'password_change_network',networkHash:network,
    limit:PASSWORD_NETWORK_LIMIT,seconds:PASSWORD_LIMIT_SECONDS,
  });
  if(networkLimit.limited)
    return credentialThrottle('Too many password attempts. Please try again later.',networkLimit);

  let providerSession='';
  try {
    providerSession=await providerPasswordSession(auth,currentPassword);
    // The provider sign-in above is the current-password verification boundary.
    // Clear the shared failure budget as soon as that verification succeeds so
    // valid users are not penalized for a later new-password policy rejection.
    // The account-plus-network submission bucket still ages out naturally.
    await clearCredentialLimit(query,{authUserId:auth.user_id,purpose:'current_password'});
    let changed;
    try {
      changed=await neonAuthSession('/change-password',{cookie:providerSession,body:{
        currentPassword,
        newPassword,
        revokeOtherSessions:true,
      }});
    } catch(error) {
      providerSession=error?.providerCookie||providerSession;
      const status=Number(error?.status||500);
      if(status>=500)
        throw Object.assign(Error('Password change is temporarily unavailable.'),{status:503,code:'PROVIDER_FAILURE'});
      throw Object.assign(Error('The new password was not accepted.'),{status:400,code:'PASSWORD_POLICY'});
    }
    providerSession=changed.cookie||providerSession;
    await revokeAllAccountSessions(query,auth.user_id);
    return clearAccountCookies(json({ok:true,signedOut:true}));
  } finally {
    await closeProviderSession(providerSession);
  }
}


const DELETE_INIT_LIMIT=3;
const DELETE_VERIFY_LIMIT=8;
const DELETE_NETWORK_LIMIT=5;
const DELETE_LIMIT_SECONDS=15*60;

async function recoveryKeyForDeletion(operation,knownEmail=null) {
  let email=knownEmail;
  if(!email) {
    const row=await query('SELECT email FROM neon_auth."user" WHERE id=$1::uuid LIMIT 1',[operation.auth_user_id]);
    email=row.rows[0]?.email||null;
  }
  return deletionRecoveryKey(email);
}

async function resumeDeletionOperation(operation,{knownEmail=null}={}) {
  let current=operation;
  if(['pending','app_cleanup_complete'].includes(current.state)) {
    const recoveryKey=await recoveryKeyForDeletion(current,knownEmail);
    current=await cleanupPackOne(query,current,{recoveryKey});
  }
  if(current.state==='provider_delete_pending') {
    const result=await removeProviderUser({
      authBase:NEON_AUTH_BASE,
      authUserId:current.auth_user_id,
      validateServicePrincipal:async serviceId=>{
        const linked=await query('SELECT 1 FROM account_links WHERE auth_user_id=$1::uuid LIMIT 1',[serviceId]);
        return linked.rows.length===0;
      },
    });
    current=await finishProviderPhase(query,current,result);
    if(current.state==='operator_review') {
      const age=Math.max(0,Math.floor((Date.now()-new Date(current.created_at).getTime())/1000));
      console.error(JSON.stringify({
        event:'account_deletion_operator_review',
        operation_id:current.operation_id,
        phase:current.state,
        age_seconds:age,
        attempts:Number(current.attempts||0),
        error_code:current.last_error_code||'PROVIDER_FAILURE',
        release_commit:releaseMetadata().release_commit,
      }));
    }
  }
  return current;
}

async function handleAccountDeleteVerificationStart(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const auth=await authSession(request,{required:true,allowLegacy:false,csrf:true});
  if(!deletionEnabled())
    throw Object.assign(Error('Account deletion is temporarily unavailable.'),{status:503,code:'DELETION_DISABLED'});
  const payload=await readJson(request);
  if(payload.confirm!==true)
    throw Object.assign(Error('Confirm permanent account deletion.'),{status:400,code:'DELETE_CONFIRMATION'});
  const state=await credentialState(auth.user_id);
  if(state.password)
    throw Object.assign(Error('Use your current password to delete this account.'),{status:409,code:'PASSWORD_DELETE_REQUIRED'});
  if(!deletionEmailConfigured())
    throw Object.assign(Error('Account deletion verification is temporarily unavailable.'),{status:503,code:'DELETION_EMAIL_UNAVAILABLE'});
  const email=await deletionEmailForAuth(query,auth.user_id);
  if(!email)
    throw Object.assign(Error('Account deletion requires a verified account email.'),{status:409,code:'DELETION_EMAIL_UNAVAILABLE'});

  const initLimit=await consumeCredentialLimit(query,{
    authUserId:auth.user_id,purpose:'account_delete_init',
    limit:DELETE_INIT_LIMIT,seconds:DELETE_LIMIT_SECONDS,
  });
  if(initLimit.limited)return credentialThrottle('Too many deletion attempts. Please try again later.',initLimit);
  const network=trustedCredentialNetwork(request);
  const networkLimit=await consumeCredentialLimit(query,{
    authUserId:auth.user_id,purpose:'account_delete_network',networkHash:network,
    limit:DELETE_NETWORK_LIMIT,seconds:DELETE_LIMIT_SECONDS,
  });
  if(networkLimit.limited)return credentialThrottle('Too many deletion attempts. Please try again later.',networkLimit);

  const verification=await createDeletionVerification(query,{authUserId:auth.user_id,email});
  return json({ok:true,verification:'sent',expiresInSeconds:verification.expiresInSeconds});
}

async function handleAccountDelete(request) {
  requireTrustedOrigin(request,ALLOWED_ORIGINS);
  const auth=await authSession(request,{required:true,allowLegacy:false,csrf:true});
  if(!deletionEnabled())
    throw Object.assign(Error('Account deletion is temporarily unavailable.'),{status:503,code:'DELETION_DISABLED'});
  const payload=await readJson(request);
  if(payload.confirm!==true)
    throw Object.assign(Error('Confirm permanent account deletion.'),{status:400,code:'DELETE_CONFIRMATION'});
  const state=await credentialState(auth.user_id);

  if(state.password) {
    const currentPassword=String(payload.currentPassword||'');
    if(currentPassword.length<1||currentPassword.length>256)
      throw Object.assign(Error('Enter your current password.'),{status:400,code:'CURRENT_PASSWORD'});

    const initLimit=await consumeCredentialLimit(query,{
      authUserId:auth.user_id,purpose:'account_delete_init',
      limit:DELETE_INIT_LIMIT,seconds:DELETE_LIMIT_SECONDS,
    });
    if(initLimit.limited)return credentialThrottle('Too many deletion attempts. Please try again later.',initLimit);
    const verifyLimit=await consumeCredentialLimit(query,{
      authUserId:auth.user_id,purpose:'account_delete_verify',
      limit:DELETE_VERIFY_LIMIT,seconds:DELETE_LIMIT_SECONDS,
    });
    if(verifyLimit.limited)return credentialThrottle('Too many verification attempts. Please try again later.',verifyLimit);
    const network=trustedCredentialNetwork(request);
    const networkLimit=await consumeCredentialLimit(query,{
      authUserId:auth.user_id,purpose:'account_delete_network',networkHash:network,
      limit:DELETE_NETWORK_LIMIT,seconds:DELETE_LIMIT_SECONDS,
    });
    if(networkLimit.limited)return credentialThrottle('Too many deletion attempts. Please try again later.',networkLimit);

    let providerSession='';
    try {
      providerSession=await providerPasswordSession(auth,currentPassword);
      try {
        await neonAuthSession('/verify-password',{cookie:providerSession,body:{password:currentPassword}});
      } catch(error) {
        const status=Number(error?.status||500);
        if(status>=500)throw Object.assign(Error('Account deletion is temporarily unavailable.'),{status:503,code:'PROVIDER_FAILURE'});
        throw Object.assign(Error('Current password was not accepted.'),{status:400,code:'CURRENT_PASSWORD'});
      }
      await clearCredentialLimit(query,{authUserId:auth.user_id,purpose:'account_delete_verify'});
    } finally {
      await closeProviderSession(providerSession);
    }
  } else {
    // Passwordless deletion still requires authenticated gateway network proof,
    // but verification submissions spend only the account-scoped verify bucket.
    trustedCredentialNetwork(request);
    const verifyLimit=await consumeCredentialLimit(query,{
      authUserId:auth.user_id,purpose:'account_delete_verify',
      limit:DELETE_VERIFY_LIMIT,seconds:DELETE_LIMIT_SECONDS,
    });
    if(verifyLimit.limited)return credentialThrottle('Too many verification attempts. Please try again later.',verifyLimit);
    const code=String(payload.code||'').trim();
    let verified=false;
    try {
      verified=await consumeDeletionVerification(query,{authUserId:auth.user_id,code});
    } catch(error) {
      if(error?.code==='DELETE_CODE_INVALID')
        throw Object.assign(Error('Deletion code is invalid or expired.'),{status:400,code:'DELETE_CODE_INVALID'});
      throw error;
    }
    if(!verified)
      throw Object.assign(Error('Deletion code is invalid or expired.'),{status:400,code:'DELETE_CODE_INVALID'});
    await clearCredentialLimit(query,{authUserId:auth.user_id,purpose:'account_delete_verify'});
  }

  const operation=await beginDeletion(query,{authUserId:auth.user_id});
  if(!operation)throw Object.assign(Error('Account deletion could not be started.'),{status:500,code:'DELETE_START'});
  const final=await resumeDeletionOperation(operation,{knownEmail:auth.email});
  const complete=final?.state==='complete';
  let response=json({
    ok:true,
    deletion:complete?'complete':'accepted',
    operationId:final?.operation_id,
  },complete?200:202);
  response=clearPlayerCookie(clearAccountCookies(response));
  return response;
}

function bearer(request) {
  const value=String(request.headers.get('authorization')||'');
  return value.startsWith('Bearer ')?value.slice(7):'';
}

async function handleDeletionMaintenance(request) {
  if(request.method!=='POST')throw Object.assign(Error('Not found.'),{status:404});
  await verifyDeletionMaintenanceToken(bearer(request));
  const advanced=[];
  if(deletionEnabled()) {
    for(const operation of await maintenanceBatch(query,{limit:20})) {
      if(operation.state==='operator_review')continue;
      try {
        const next=await resumeDeletionOperation(operation);
        advanced.push({operation_id:next.operation_id,state:next.state});
      } catch(error) {
        await query(`UPDATE account_deletion_operations SET attempts=attempts+1,last_error_code='MAINTENANCE_FAILURE',updated_at=now()
          WHERE operation_id=$1::uuid AND state<>'complete'`,[operation.operation_id]);
        console.error(JSON.stringify({
          event:'account_deletion_maintenance_failure',
          operation_id:operation.operation_id,
          phase:operation.state,
          age_seconds:Math.max(0,Math.floor((Date.now()-new Date(operation.created_at).getTime())/1000)),
          attempts:Number(operation.attempts||0)+1,
          error_code:'MAINTENANCE_FAILURE',
          release_commit:releaseMetadata().release_commit,
        }));
      }
    }
  }
  const swept=verificationSweepEnabled()?await sweepExpiredVerification(query,{limit:200}):null;
  const remaining=await maintenanceBatch(query,{limit:50});
  const attention=remaining.filter(row=>stuckDeletion(row)).map(row=>({
    operation_id:row.operation_id,
    state:row.state,
    age_seconds:Math.max(0,Math.floor((Date.now()-new Date(row.created_at).getTime())/1000)),
    attempts:Number(row.attempts||0),
    error_code:row.last_error_code||null,
  }));
  return json({
    ok:attention.length===0,
    deletion_enabled:deletionEnabled(),
    sweep_enabled:verificationSweepEnabled(),
    advanced,
    swept_expired_verifications:swept,
    attention,
  },attention.length?503:200);
}

async function handleSignout(request) {
  // Sign-out must always be able to clear the cookies it set, including when
  // the session behind them is already expired or revoked. A live session is
  // still CSRF-checked, so this stays a deliberate first-party request.
  const auth = await authSession(request,{required:false});
  if(auth)await revokeAccountSession(query,auth);
  return clearPlayerCookie(clearAccountCookies(json({ ok: true })));
}

async function handleDates(request) {
  const auth = await authSession(request);
  const link = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid', [auth.user_id]);
  if (!link.rows[0]?.player_id) return json({ dates: [] });
  const dates = await query(
    'SELECT DISTINCT challenge_date::text date FROM scores WHERE player_id=$1::uuid ORDER BY date DESC LIMIT 366',
    [link.rows[0].player_id],
  );
  return json({ dates: dates.rows.map((row) => row.date) });
}

async function handleMyProfile(request) {
  const id = await player(request);
  const meta = await profileMetaByPlayer(id);
  if (!meta) throw Object.assign(new Error('Player profile unavailable.'), { status: 404 });
  return json(await buildProfile(id, meta, { own: true }));
}

async function handlePublicProfile(profileKey) {
  if (!PROFILE_KEY_RE.test(profileKey)) throw Object.assign(new Error('Invalid profile.'), { status: 400 });
  const meta = await profileMetaByKey(profileKey);
  if (!meta) return json({ error: 'Profile not found or private.' }, 404);
  return json(await buildProfile(meta.player_id, meta, { own: false }));
}

async function handleProfileUpdate(request) {
  const id = await player(request);
  const meta = await profileMetaByPlayer(id);
  if (!meta) throw Object.assign(new Error('Player profile unavailable.'), { status: 404 });
  if (!bool(meta.claimed)) {
    throw Object.assign(new Error('Claim an account before publishing or customizing a profile.'), { status: 403 });
  }
  const auth = await authSession(request);
  const link = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid LIMIT 1', [auth.user_id]);
  if (link.rows[0]?.player_id !== id) {
    throw Object.assign(new Error('Sign in again to change account settings.'), { status: 403 });
  }
  const payload = await readJson(request);

  const current = await buildProfile(id, meta, { own: true });
  const catalog = await loadCatalog();
  const allowedSets = new Set((catalog.sets || []).map((entry) => String(entry?.id || '')).filter(Boolean));
  const unlocked = new Set(current.achievements.filter((item) => item.unlocked).map((item) => item.id));

  const displayName = payload.displayName === undefined ? meta.display_name : normalizeName(payload.displayName);
  const profilePublic = typeof payload.profilePublic === 'boolean' ? payload.profilePublic : bool(meta.profile_public);
  const favorite = payload.favoriteSetId === undefined ? meta.favorite_set_id || null : String(payload.favoriteSetId || '').trim().toLowerCase() || null;
  const showcase = payload.showcaseAchievement === undefined ? meta.showcase_achievement || null : String(payload.showcaseAchievement || '').trim().toLowerCase() || null;

  if (favorite && !allowedSets.has(favorite)) throw Object.assign(new Error('Choose a playable environment.'), { status: 400 });
  if (showcase && !unlocked.has(showcase)) throw Object.assign(new Error('Showcase an achievement you have unlocked.'), { status: 400 });

  // This is the one path where an account owner deliberately chooses a name, so
  // it is also where ownership is taken. `players_username_uq` decides whether
  // the name is free: a preflight check could only narrow the race, not close
  // it. Reverting to the placeholder releases the previous name.
  try {
    await query(
      `WITH previous AS MATERIALIZED (SELECT profile_public,display_name FROM players WHERE id=$1::uuid FOR UPDATE), changed AS (UPDATE players
       SET display_name=$2,profile_public=$3::boolean,favorite_set_id=$4,showcase_achievement=$5,username_owned=$6::boolean,updated_at=now()
       FROM previous WHERE id=$1::uuid RETURNING previous.profile_public was_public,previous.display_name old_display_name),
       events(event_name) AS (
         SELECT 'public_profile_enabled' FROM changed WHERE NOT was_public AND $3::boolean
         UNION ALL
         SELECT 'leaderboard_name_changed' FROM changed WHERE old_display_name IS DISTINCT FROM $2
       )
       INSERT INTO analytics_events(player_id,event_name) SELECT $1::uuid,event_name FROM events`,
      [id, displayName, profilePublic, favorite, showcase, !isPlaceholderUsername(displayName)],
    );
  } catch (error) {
    rethrowUsernameConflict(error);
  }
  const updatedMeta = await profileMetaByPlayer(id);
  return json(await buildProfile(id, updatedMeta, { own: true }));
}
async function handleMyHistory(request) {
  const id = await player(request);
  const url = new URL(request.url);
  return json(await historyPage(id, url.searchParams.get('cursor'), url.searchParams.get('limit')));
}

async function handlePublicHistory(profileKey, request) {
  if (!PROFILE_KEY_RE.test(profileKey)) throw Object.assign(new Error('Invalid profile.'), { status: 400 });
  const meta = await profileMetaByKey(profileKey);
  if (!meta) return json({ error: 'Profile not found or private.' }, 404);
  const url = new URL(request.url);
  return json(await historyPage(meta.player_id, url.searchParams.get('cursor'), url.searchParams.get('limit')));
}

async function handleProfileLookup(request) {
  const payload = await readJson(request);
  const names = [...new Set((Array.isArray(payload.names) ? payload.names : [])
    .map((value) => String(value || '').trim().slice(0, 24))
    .filter((value) => value.length >= 2))].slice(0, 100);
  if (!names.length) return json({ profiles: {} });
  const result = await query(
    `WITH wanted AS (
       SELECT lower(value) lookup FROM jsonb_array_elements_text($1::jsonb)
     ), matches AS (
       SELECT w.lookup,p.display_name,p.profile_key,p.showcase_achievement,
              count(*) OVER (PARTITION BY w.lookup) match_count
       FROM wanted w
       JOIN players p ON lower(p.display_name)=w.lookup
       WHERE p.profile_public=true
     )
     SELECT lookup,display_name,profile_key,showcase_achievement
     FROM matches
     WHERE match_count=1`,
    [JSON.stringify(names)],
  );
  const profiles = {};
  for (const row of result.rows) {
    profiles[row.lookup] = { display_name: row.display_name, profile_key: row.profile_key, showcase_achievement: row.showcase_achievement || null };
  }
  return json({ profiles });
}

async function route(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, ...releaseMetadata(), service: 'pack1-growth', version: 3, profiles: true, account_deletion_enabled:deletionEnabled(), verification_sweep_enabled:verificationSweepEnabled(), deletion_email_configured:deletionEmailConfigured() });
  if (url.pathname === '/internal/account-deletion-maintenance') return handleDeletionMaintenance(request);
  if (request.method === 'GET' && url.pathname === '/v1/account/google/callback') return handleGoogleCallback(request);
  if (url.pathname.startsWith('/v1/patreon/')) return handlePatreon(request,{query,authSession,json});
  if (request.method === 'POST' && url.pathname === '/v1/player/session') return handleBrowserPlayerSession(request);
  if (request.method === 'POST' && url.pathname === '/v1/player/migrate') return handlePlayerMigration(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/signup') return handleAccountSignup(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/signin') return handleAccountSignin(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/send-verification-email') return handleVerificationEmailRequest(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/request-password-reset') return handlePasswordResetRequest(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/reset-password') return handlePasswordReset(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/password-change') return handlePasswordChange(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/delete/verification/start') return handleAccountDeleteVerificationStart(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/delete') return handleAccountDelete(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/migrate') return handleAccountMigration(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/link-browser') return handleLink(request,{browser:true});
  if (request.method === 'POST' && url.pathname === '/v1/session') return handleSession(request);
  if (request.method === 'POST' && url.pathname === '/v1/events') return handleEvents(request);
  if (request.method === 'POST' && url.pathname === '/v1/results') return handleResult(request);
  if (request.method === 'GET' && url.pathname === '/v1/stats') return handleStats(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/link') return handleLink(request);
  if (request.method === 'GET' && url.pathname === '/v1/account/session') return handleAccount(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/signout') return handleSignout(request);
  if (request.method === 'GET' && url.pathname === '/v1/account/daily-dates') return handleDates(request);
  if (request.method === 'GET' && url.pathname === '/v1/profile/me') return handleMyProfile(request);
  if (request.method === 'PATCH' && url.pathname === '/v1/profile') return handleProfileUpdate(request);
  if (request.method === 'GET' && url.pathname === '/v1/profile/history') return handleMyHistory(request);
  if (request.method === 'POST' && url.pathname === '/v1/profile-lookup') return handleProfileLookup(request);

  const historyMatch = url.pathname.match(/^\/v1\/profile\/([a-f0-9]{16})\/history$/);
  if (request.method === 'GET' && historyMatch) return handlePublicHistory(historyMatch[1], request);
  const profileMatch = url.pathname.match(/^\/v1\/profile\/([a-f0-9]{16})$/);
  if (request.method === 'GET' && profileMatch) return handlePublicProfile(profileMatch[1]);
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request) {
    const maintenance=new URL(request.url).pathname==='/internal/account-deletion-maintenance';
    if(!maintenance){const denied=guardIngress(request);if(denied)return denied;}
    try {
      return withCors(await route(request), request);
    } catch (error) {
      console.error(error);
      const status=Number(error?.status||500);
      const response=json({ error: status===500?'Request failed. Please try again.':error.message,...(error?.code?{code:String(error.code)}:{}) },status);
      if(error.retryAfter)response.headers.set('retry-after',String(error.retryAfter));
      return withCors(response, request);
    }
  },
};

export { query, player, readJson, json, withCors, gameDateKey, normalizedRecoveryEmail, recoveryRateKey, consumeRecoveryLimit };
