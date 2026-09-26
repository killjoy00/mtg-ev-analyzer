// Isolated plan experiment: preserve every candidate predicate and exact ordering.
import assert from 'node:assert/strict';
export function orderedRerollQuery(sql) {
  const m=sql.match(/^SELECT \* FROM \(SELECT ([\s\S]+?),(\(abs[\s\S]+?) distance FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r\s+ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1' WHERE ([\s\S]+)\) candidates\s+WHERE distance<=0.16 ORDER BY distance,puzzle_id COLLATE "C" LIMIT 20$/);
  assert.ok(m,'known reroll statement');
  const [,columns,distance,conditions]=m,rating=[];
  let where=conditions.replace(/r\.target_support_ratio >= [0-9.]+::float8|r\.band<>'easy'|r\.band=\$\d+ AND r\.rating BETWEEN \$\d+::int AND \$\d+::int/g,part=>{rating.push(part);return 'TRUE';});
  assert.ok(!/\br\./.test(where),'all rating predicates separated');
  const pColumns=columns.split(',r.difficulty_version')[0];
  return `SELECT ${columns},p.distance FROM (
    SELECT ${pColumns},${distance} distance FROM draft_run_verified_puzzles p
    WHERE ${where} AND (${distance})<=0.16 ORDER BY distance,p.puzzle_id COLLATE "C" OFFSET 0
  ) p JOIN LATERAL (
    SELECT r.* FROM draft_run_puzzle_ratings r WHERE r.puzzle_id=p.puzzle_id
    AND r.difficulty_version='support-ratio-v1' AND ${rating.join(' AND ')} OFFSET 0
  ) r ON true ORDER BY p.distance,p.puzzle_id COLLATE "C" LIMIT 20`;
}
