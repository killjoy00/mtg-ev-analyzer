// Persistent per-player limits apply across function instances. They do not
// prevent an attacker creating new anonymous identities; ingress limits remain
// necessary for session creation and unauthenticated traffic.
export async function consumePlayerLimit(query,playerId,scope,{limit=300,seconds=60,cost=1}={}) {
  if(!Number.isInteger(cost)||cost<1||cost>limit)throw Object.assign(new Error('Too many requests. Please try again shortly.'),{status:429,retryAfter:seconds});
  const result=await query(`INSERT INTO player_request_limits(player_id,scope,used,resets_at)
    VALUES($1::uuid,$2,$3::int,now()+make_interval(secs=>$4::int))
    ON CONFLICT(player_id,scope) DO UPDATE SET
      used=CASE WHEN player_request_limits.resets_at<=now() THEN $3::int ELSE player_request_limits.used+$3::int END,
      resets_at=CASE WHEN player_request_limits.resets_at<=now() THEN now()+make_interval(secs=>$4::int) ELSE player_request_limits.resets_at END
    WHERE player_request_limits.resets_at<=now() OR player_request_limits.used+$3::int<=$5::int
    RETURNING used`,[playerId,scope,cost,seconds,limit]);
  if(!result.rows.length)throw Object.assign(new Error('Too many requests. Please try again shortly.'),{status:429,retryAfter:seconds});
}
