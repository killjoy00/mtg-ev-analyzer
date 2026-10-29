import {draftRunLength} from './draft-run-format.mjs';
import { profileShareSummary } from './profile-core.mjs';

const SHARE_ORIGIN = 'https://packone.pro/';

function cardUrl(profile) {
  const key = profile?.player?.profile_key;
  return profile?.player?.profile_public && key ? `${SHARE_ORIGIN}?profile=${encodeURIComponent(key)}` : SHARE_ORIGIN;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, startSize, minSize = 24, weight = 760) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function drawPill(ctx, text, x, y) {
  ctx.font = '700 23px system-ui, -apple-system, sans-serif';
  const width = ctx.measureText(text).width + 32;
  roundRect(ctx, x, y, width, 43, 22);
  ctx.fillStyle = '#e7f0ea';
  ctx.fill();
  ctx.fillStyle = '#234d39';
  ctx.fillText(text, x + 16, y + 29);
  return width;
}

async function cardBlob({ eyebrow, title, bigValue, subtitle, pills = [], rows = [], footer = 'Play Pack One · packone.pro' }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f7f7f5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#171918';
  ctx.fillRect(0, 0, 22, canvas.height);

  ctx.fillStyle = '#2f654a';
  ctx.font = '800 24px system-ui, -apple-system, sans-serif';
  ctx.fillText(String(eyebrow || 'PACK ONE').toUpperCase(), 72, 78);

  const titleText = String(title || 'Pack One');
  const titleSize = fitText(ctx, titleText, 720, 58, 32, 760);
  ctx.fillStyle = '#171918';
  ctx.font = `760 ${titleSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(titleText, 72, 150);

  if (subtitle) {
    ctx.fillStyle = '#666c68';
    ctx.font = '500 26px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(subtitle), 74, 193);
  }

  roundRect(ctx, 72, 230, 400, 214, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#d9ddd9';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#171918';
  const big = String(bigValue || 'N/A');
  const bigSize = fitText(ctx, big, 340, 88, 52, 800);
  ctx.font = `800 ${bigSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(big, 104, 340);
  ctx.fillStyle = '#666c68';
  ctx.font = '700 21px system-ui, -apple-system, sans-serif';
  ctx.fillText('PACK ONE RECORD', 106, 390);

  let pillX = 74;
  let pillY = 474;
  for (const pill of pills.slice(0, 4)) {
    const width = drawPill(ctx, String(pill), pillX, pillY);
    pillX += width + 10;
    if (pillX > 920) {
      pillX = 74;
      pillY += 50;
    }
  }

  let rowY = 260;
  for (const row of rows.slice(0, 5)) {
    ctx.fillStyle = '#8b918d';
    ctx.font = '800 18px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(row.label || '').toUpperCase(), 540, rowY);
    ctx.fillStyle = '#171918';
    ctx.font = '740 30px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(row.value ?? 'N/A'), 540, rowY + 38);
    rowY += 74;
  }

  ctx.fillStyle = '#666c68';
  ctx.font = '650 22px system-ui, -apple-system, sans-serif';
  ctx.fillText(footer, 540, 578);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.94));
}

// Some iOS share targets accept only the URL field when URL and text are
// provided separately. Keep the score/squares and link in a single text item
// so Messages can retain the whole result while still linkifying the URL.
export function draftRunNativeShareData(text, url, { userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return ios ? { text: `${text}\n${url}` } : { title: 'Pack One', text, url };
}

async function shareBlob(blob, { text, url, filename, context }) {
  const payloadText = String(text || 'Pack One');
  const shareUrl = String(url || SHARE_ORIGIN);
  let method = 'copy_fallback';
  const draftRunTextOnly = !blob && (context === 'draft_run_result' || context === 'draft_run_challenge');
  const nativeData = draftRunTextOnly
    ? draftRunNativeShareData(payloadText, shareUrl, { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints })
    : { title: 'Pack One', text: payloadText, url: shareUrl };
  try {
    const file = blob ? new File([blob], filename || 'pack-one.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'Pack One', text: payloadText, url: shareUrl, files: [file] });
      method = 'native_file';
    } else if (navigator.share) {
      await navigator.share(nativeData);
      method = 'native';
    } else {
      await navigator.clipboard.writeText(`${payloadText}\n${shareUrl}`);
    }
  } catch (error) {
    if (error?.name === 'AbortError') return { cancelled: true };
    try { await navigator.clipboard.writeText(`${payloadText}\n${shareUrl}`); }
    catch { return { failed:true, url:shareUrl }; }
  }
  document.dispatchEvent(new CustomEvent('pack1:share-completed', {
    detail: { method, context: context || 'profile', challenge: false },
  }));
  return { method };
}

export async function shareProfileCard(profile, progress, catalogNames = new Map()) {
  const summary = profileShareSummary(profile, progress);
  const labels = summary.bestEnvironments.map((id) => catalogNames.get(id.toLowerCase()) || id);
  const showcased = (profile.achievements || []).find((item) => item.id === profile.player.showcase_achievement && item.unlocked);
  const blob = await cardBlob({
    eyebrow: 'Player profile',
    title: summary.name,
    bigValue: `${summary.average.toFixed(1)} AVG`,
    subtitle: `${summary.games} scored games`,
    pills: [
      `${summary.environmentsPlayed}/${summary.environmentTotal} environments`,
      `${summary.streak}-day streak`,
      ...(showcased ? [showcased.label] : []),
    ],
    rows: [
      { label: 'Best score', value: summary.best },
      { label: 'Best environments', value: labels.join(' · ') || 'Building the archive' },
      { label: 'Progress', value: `${summary.environmentsPlayed}/${summary.environmentTotal}` },
    ],
  });
  return shareBlob(blob, {
    text: `${summary.name}'s Pack One profile · ${summary.average.toFixed(1)} average · ${summary.environmentsPlayed}/${summary.environmentTotal} environments played.`,
    url: cardUrl(profile),
    filename: 'pack-one-profile.png',
    context: 'profile_card',
  });
}

export async function shareProgressCard(profile, progress) {
  const name = profile?.player?.display_name || 'Pack Player';
  const blob = await cardBlob({
    eyebrow: 'Archive progress',
    title: name,
    bigValue: `${progress.played}/${progress.total}`,
    subtitle: 'Pack One environments played',
    pills: progress.played === progress.total && progress.total ? ['Archive complete'] : ['Keep exploring'],
    rows: [
      { label: 'Games', value: Number(profile?.summary?.games || 0) },
      { label: 'Average', value: Number(profile?.summary?.average_score || 0).toFixed(1) },
      { label: 'Best', value: Number(profile?.summary?.best_score || 0) },
    ],
  });
  return shareBlob(blob, {
    text: `${name} has played ${progress.played}/${progress.total} Pack One environments.`,
    url: cardUrl(profile),
    filename: 'pack-one-archive-progress.png',
    context: 'archive_progress',
  });
}

export async function shareAchievementCard(profile, achievement) {
  const name = profile?.player?.display_name || 'Pack Player';
  const blob = await cardBlob({
    eyebrow: 'Achievement unlocked',
    title: achievement.label,
    bigValue: 'UNLOCKED',
    subtitle: name,
    pills: [achievement.progress_text || 'Pack One achievement'],
    rows: [
      { label: 'What it means', value: achievement.description },
    ],
  });
  return shareBlob(blob, {
    text: `${name} unlocked “${achievement.label}” on Pack One.`,
    url: cardUrl(profile),
    filename: `pack-one-${achievement.id}.png`,
    context: 'achievement',
  });
}

export async function shareResultCard(profile, result, environmentName = null) {
  const name = profile?.player?.display_name || 'Pack Player';
  const env = environmentName || String(result?.set_id || '').toUpperCase();
  const percentile = Number(result?.percentile);
  const percentileText = Number.isFinite(percentile) && percentile > 0 ? `Top ${percentile}%` : null;
  const blob = await cardBlob({
    eyebrow: result?.is_daily || result?.date ? 'Daily result' : 'Game result',
    title: result?.mode === 'draft_run' ? (result?.set_id === 'latest' ? 'Latest Set Run' : result?.set_id === 'powered-cube' ? 'Powered Cube Run' : 'Draft Run') : `${env} · ${result?.mode === 'top3' ? 'Top 3' : result?.set_id === 'powered-cube' ? 'Cube Pack Run' : 'Full Pack'}`,
    bigValue: `${Number(result?.score || 0)}/100`,
    subtitle: `${name} · ${result?.grade || ''}`,
    pills: [percentileText, result?.date].filter(Boolean),
    rows: [
      ...(percentileText ? [{ label: result?.final === false ? 'Current standing' : 'Final percentile', value: percentileText }] : []),
      ...(Number(result?.rank) && Number(result?.total) ? [{ label: 'Leaderboard', value: `#${result.rank} of ${result.total}` }] : []),
    ],
  });
  return shareBlob(blob, {
    text: `${name} scored ${Number(result?.score || 0)}/100 (${result?.grade || 'scored'}) on ${env}${percentileText ? ` · ${percentileText}` : ''}.`,
    url: cardUrl(profile),
    filename: 'pack-one-result.png',
    context: percentileText ? 'daily_result' : 'game_result',
  });
}

// One grade per pick, shown as a colored square in the shared text.
const GRADE_EMOJI={match:'🟩',strong:'🟦',good:'🟨',fair:'🟧',miss:'⬛'};
export function pickGrades(answers) {
  return answers.map(a=>a.historicalMatch?'match':a.score>=85?'strong':a.score>=60?'good':a.score>=25?'fair':'miss');
}
const SHARE_PATHS={latest:'latest','powered-cube':'powered-cube',mixed:'mixed'};
export function dailyModeLabel(environment) {
  return environment==='latest'?'Latest Set':environment==='powered-cube'?'Powered Cube':'Draft Run';
}
export function shareDate(day) {
  return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
}
// Recipients land straight in their own current Daily. The date lets the
// landing explain when a friend's score came from an earlier Daily.
export function dailyShareUrl(run,origin=SHARE_ORIGIN) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(run?.day||'')))throw new Error('A Daily share needs its Daily date.');
  const url=new URL(`/share/daily/${SHARE_PATHS[run.environment]||'mixed'}/`,origin);
  url.searchParams.set('ref','result_share');
  url.searchParams.set('d',run.day);
  return url.toString();
}

export function draftRunShareText(run) {
  const matches=run.answers.filter(a=>a.historicalMatch).length;
  const label=dailyModeLabel(run.environment);
  const squares=pickGrades(run.answers).map(g=>GRADE_EMOJI[g]).join('');
  // Dated, and never "beat my score": a link opened tomorrow plays different picks.
  if(run.day) return `I scored ${run.score}/100 on the Pack One ${label} Daily (${shareDate(run.day)}).\n${squares}\n${matches}/${draftRunLength(run)} trophy picks matched.\nPlay today’s Daily yourself. Free, no account needed:`;
  return `Pack One · ${label} · Practice\n${run.score}/100  ${squares}\n${matches}/${draftRunLength(run)} trophy picks matched. Play this run and compare.`;
}

export async function shareDraftRunCard(run,url,{challenge=false,asImage=false}={}) {
  const matches=run.answers.filter(a=>a.historicalMatch).length;
  const percentile=run.standing?.percentile;
  const cube=run.environment==='powered-cube',label=run.environment==='latest'?'Latest Set Run':cube?'Powered Cube Run':'Draft Run';
  const text=draftRunShareText(run);
  if(!asImage) return shareBlob(null,{text,url,context:challenge?'draft_run_challenge':'draft_run_result'});
  const blob=await cardBlob({eyebrow:`${run.day?'Daily ':''}${label}`,title:`${draftRunLength(run)} picks. Your call.`,bigValue:`${run.score}/100`,subtitle:`${matches} trophy picks matched`,pills:[run.day,percentile?`Top ${percentile}% ${run.standing.final?'finish':'so far'}`:null].filter(Boolean),rows:[{label:'The run',value:run.environment==='latest'?`${draftRunLength(run)} decisions from the latest set`:cube?`${draftRunLength(run)} Powered Cube trophy decisions`:`${draftRunLength(run)} decisions across Magic sets`},{label:'The picks',value:'From real trophy drafts'}]});
  return shareBlob(blob,{text,url,filename:'pack-one-draft-run.png',context:challenge?'draft_run_challenge':'draft_run_result'});
}
