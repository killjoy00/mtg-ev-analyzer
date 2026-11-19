// Retained pre-optimization query for isolated exact-row parity and plan evidence.
import assert from 'node:assert/strict';
export function referenceRerollQuery(sql) {
  const columns=sql.slice('SELECT '.length,sql.indexOf(',p.distance FROM ('));
  const puzzleColumns=columns.slice(0,columns.indexOf(',r.difficulty_version'));
  const distanceStart=sql.indexOf('    SELECT '+puzzleColumns+',')+('    SELECT '+puzzleColumns+',').length;
  const distance=sql.slice(distanceStart,sql.indexOf(' distance FROM draft_run_verified_puzzles p',distanceStart));
  const whereStart=sql.indexOf('    WHERE ')+10;
  const where=sql.slice(whereStart,sql.indexOf(' AND ('+distance+')<=0.16',whereStart));
  const ratingStart=sql.indexOf("AND r.difficulty_version='support-ratio-v1' AND ")+"AND r.difficulty_version='support-ratio-v1' AND ".length;
  const rating=sql.slice(ratingStart,sql.indexOf(' OFFSET 0',ratingStart));
  assert.ok(columns.includes('r.band')&&distance.startsWith('(abs')&&where.includes('p.pick_number')&&rating.includes('r.target_support_ratio'),'known ordered reroll statement');
  return `SELECT * FROM (SELECT ${columns},${distance} distance FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE ${where} AND ${rating}) candidates WHERE distance<=0.16 ORDER BY distance,puzzle_id COLLATE "C" LIMIT 20`;
}
