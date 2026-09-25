// Controlled aggregate arithmetic and review-detail checks; development only.
import fs from 'node:fs';import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated development connection and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query,readJson}=await import('../worker/growth-function.js');
const {handleAdmin}=await import('../worker/measurement-admin.mjs');
const user=crypto.randomUUID(),token=crypto.randomUUID(),version='math-'+crypto.randomUUID().slice(0,8);let ids=[],players=[],habitSessionIds=[],habitPlayers=[],habitUsers=[];
try {
 await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[user,'QA report math',`qa-math-${user}@example.invalid`]);
 await query('INSERT INTO neon_auth.session(id,"userId",token,"updatedAt","expiresAt") VALUES($1::uuid,$2::uuid,$3,now(),now()+interval \'1 hour\')',[crypto.randomUUID(),user,token]);
 await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[user]);
 const source=(await query('SELECT * FROM draft_run_sessions WHERE selection_version=\'first-pack-v2\' ORDER BY created_at DESC LIMIT 1')).rows[0];
 const puzzleIds=JSON.parse(source.puzzle_ids),puzzle=(await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[puzzleIds[0]])).rows[0];const p=JSON.parse(puzzle.payload);
 const data=Array.from({length:5},(_,i)=>({id:crypto.randomUUID(),player:crypto.randomUUID(),score:[100,100,20,50,80][i],match:i<2,selected:i<2?p.historical_pick_id:p.candidates.find(c=>c.id!==p.historical_pick_id).id,ms:(i+1)*1000}));ids=data.map(x=>x.id);players=data.map(x=>x.player);
 await query(`WITH data AS (SELECT * FROM jsonb_to_recordset($1::jsonb) d(id uuid,player uuid,score int,match boolean,selected text,ms int)),
 players_added AS (INSERT INTO players(id,display_name) SELECT player,'Report math fixture' FROM data),
 sessions_added AS (INSERT INTO draft_run_sessions(id,player_id,seed,corpus_version,scoring_version,puzzle_ids,seen_sources,environment,difficulty_version,selection_version)
 SELECT id,player,id::text,$2,$3,$4::jsonb,'[]'::jsonb,'mixed','support-ratio-v1',$5 FROM data RETURNING id)
 INSERT INTO draft_run_decision_observations(session_id,revision,round,puzzle_id,observed,outcome,answered_at,selected_id,score,trophy_match,active_ms)
 SELECT d.id,0,1,$6,true,'pick',now(),d.selected,d.score,d.match,d.ms FROM data d JOIN sessions_added s ON s.id=d.id`,[JSON.stringify(data),source.corpus_version,source.scoring_version,source.puzzle_ids,version,puzzleIds[0]]);
 const today=new Date().toISOString().slice(0,10),funnelUrl='https://packone.pro/v1/admin/measurements?from='+today+'&to='+today+'&environment=mixed';
 const beforeFunnel=(await handleAdmin(new Request(funnelUrl,{headers:{'x-pack1-auth-session':token}}),query,readJson)).share_funnel;
 await query(`INSERT INTO analytics_events(player_id,event_name,event_props) VALUES
   ($1::uuid,'daily_share_arrival',jsonb_build_object('source','result_share','daily',true,'session_id','math-share')),
   ($1::uuid,'daily_started',jsonb_build_object('source','result_share','daily',true,'mode','draft_run','set_id','mixed','run_id',$2::text)),
   ($1::uuid,'daily_completed',jsonb_build_object('daily',true,'mode','draft_run','set_id','mixed','run_id',$2::text))`,[data[0].player,data[0].id]);
 const afterFunnel=(await handleAdmin(new Request(funnelUrl,{headers:{'x-pack1-auth-session':token}}),query,readJson)).share_funnel;
 assert.equal(Number(afterFunnel.arrivals),Number(beforeFunnel.arrivals)+1);assert.equal(Number(afterFunnel.visitors)>=Number(beforeFunnel.visitors),true);
 assert.equal(Number(afterFunnel.starts),Number(beforeFunnel.starts)+1);assert.equal(Number(afterFunnel.completions),Number(beforeFunnel.completions)+1);
 const report=await handleAdmin(new Request('https://packone.pro/v1/admin/measurements?version='+version,{headers:{'x-pack1-auth-session':token}}),query,readJson);
 assert.equal(Number(report.summary.answers),5);assert.equal(Number(report.summary.trophy_match_pct),40);assert.equal(Number(report.summary.average_partial_credit),50);assert.equal(Number(report.summary.median_seconds),3);assert.equal(Number(report.summary.p90_seconds),4.6);assert.equal(report.reviews.length,1);
 const detail=await handleAdmin(new Request('https://packone.pro/v1/admin/decisions/'+puzzleIds[0]+'?version='+version,{headers:{'x-pack1-auth-session':token}}),query,readJson);
 assert.equal(detail.choices.reduce((n,r)=>n+Number(r.answers),0),5);
 const empty=await handleAdmin(new Request('https://packone.pro/v1/admin/measurements?version='+version+'&difficulty=invalid',{headers:{'x-pack1-auth-session':token}}),query,readJson).catch(e=>e.status);assert.equal(empty,400);

 // Launch habit metrics: authoritative Daily sessions, shared exclusions, person
 // collapsing, first-touch attribution, Pacific day bucketing and maturity.
 const isoDay=(value,offset=0)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
 const pacificToday=(await query("SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date::text AS day")).rows[0].day;
 const firstDay=isoDay(pacificToday,-20),nextDay=isoDay(firstDay,1),sixthDay=isoDay(firstDay,6),crossDay=isoDay(pacificToday,-1);
 let trackingStart=(await query("SELECT min(created_at) started_at FROM analytics_events WHERE event_name='acquisition_touch'")).rows[0].started_at;
 const addPlayer=async(name,{linked=false,admin=false}={})=>{
   const player=crypto.randomUUID();habitPlayers.push(player);
   await query('INSERT INTO players(id,display_name) VALUES($1::uuid,$2)',[player,name]);
   let auth=null;
   if(linked){
     auth=crypto.randomUUID();habitUsers.push(auth);
     await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[auth,name,`habit-${auth}@example.invalid`]);
     await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[auth,player]);
     if(admin)await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[auth]);
   }
   return {player,auth};
 };
 const touch=async(player,props,createdAt)=>query(
   "INSERT INTO analytics_events(player_id,event_name,event_props,created_at) VALUES($1::uuid,'acquisition_touch',$2::jsonb,$3::timestamptz)",
   [player,JSON.stringify(props),createdAt]
 );
 if(!trackingStart){
   const anchorPlayer=await addPlayer('Habit tracking anchor');
   const anchorAt=new Date(Date.now()-120*86400000).toISOString();
   await touch(anchorPlayer.player,{source:'direct'},anchorAt);
   trackingStart=anchorAt;
 }
 const trackingMs=new Date(trackingStart).getTime();
 const afterTracking=(days=1)=>new Date(trackingMs+days*86400000).toISOString();
 const beforeTracking=new Date(trackingMs-86400000).toISOString();
 const answersJson=JSON.stringify(Array.from({length:puzzleIds.length},()=>({})));
 const completeDaily=async(player,day,environment,{qa=false,createdAt=afterTracking(2)}={})=>{
   const id=crypto.randomUUID();habitSessionIds.push(id);
   await query(`INSERT INTO draft_run_sessions(
       id,player_id,day,seed,corpus_version,scoring_version,puzzle_ids,answers,seen_sources,rerolls,revision,score,
       created_at,updated_at,merged_daily_date,environment,difficulty_version,difficulty_anchors,selection_version,
       measurement_qa,daily_featured_sets,source_components,daily_account_id,leaderboard_eligible,custom_set_ids,serving_policy_version
     )
     SELECT $1::uuid,$2::uuid,$3::date,$1::text,corpus_version,scoring_version,puzzle_ids,$4::jsonb,seen_sources,rerolls,0,80,
       $7::timestamptz,$7::timestamptz,NULL,$5,difficulty_version,difficulty_anchors,selection_version,$6::boolean,
       daily_featured_sets,source_components,NULL,false,custom_set_ids,serving_policy_version
     FROM draft_run_sessions WHERE id=$8::uuid`,
     [id,player,day,answersJson,environment,qa,createdAt,source.id]);
   return id;
 };
 const habitUrl=(from=firstDay,to=pacificToday)=>`https://packone.pro/v1/admin/measurements?from=${from}&to=${to}`;
 const habitBefore=await handleAdmin(new Request(habitUrl(),{headers:{'x-pack1-auth-session':token}}),query,readJson);
 const beforeCohorts=habitBefore.habit_metrics?.cohorts||[];
 const beforePre=beforeCohorts.filter(r=>r.source==='pre_tracking').reduce((n,r)=>n+Number(r.cohort_people||0),0);
 const beforeDirectNone=beforeCohorts.filter(r=>r.source==='direct'&&r.campaign==='(none)').reduce((n,r)=>n+Number(r.cohort_people||0),0);
 const tag=crypto.randomUUID().replaceAll('-','').slice(0,8);

 // An untagged direct first touch remains authoritative even after a later
 // tagged visit.
 const direct=await addPlayer('Habit direct '+tag);
 await touch(direct.player,{source:'direct'},afterTracking(1));
 await completeDaily(direct.player,firstDay,'mixed');
 await touch(direct.player,{source:'reddit_'+tag,campaign:'later_'+tag},afterTracking(4));

 // Three Dailies on one Pacific date still count as one distinct day.
 const sameDaySource='same_day_'+tag,sameDayCampaign='distinct_'+tag,sameDay=await addPlayer('Habit same day '+tag);
 await touch(sameDay.player,{source:sameDaySource,campaign:sameDayCampaign},afterTracking(1));
 await completeDaily(sameDay.player,firstDay,'mixed');
 await completeDaily(sameDay.player,firstDay,'powered-cube');
 await completeDaily(sameDay.player,firstDay,'latest');
 await completeDaily(sameDay.player,nextDay,'mixed');

 // A run whose timestamps spill into a later date is still bucketed by its
 // stored Pacific Daily date.
 const crossSource='cross_'+tag,crossCampaign='midnight_'+tag,cross=await addPlayer('Habit cross '+tag);
 await touch(cross.player,{source:crossSource,campaign:crossCampaign},afterTracking(1));
 const crossTimestamp=new Date(Math.max(Date.parse(isoDay(crossDay,1)+'T08:30:00Z'),trackingMs+5*86400000)).toISOString();
 await completeDaily(cross.player,crossDay,'mixed',{createdAt:crossTimestamp});

 // Old product activity is pre_tracking even if the first captured touch later
 // carries a campaign.
 const pre=await addPlayer('Habit pre '+tag);
 await completeDaily(pre.player,firstDay,'mixed',{createdAt:beforeTracking});
 await touch(pre.player,{source:'reddit_'+tag,campaign:'pre_'+tag},afterTracking(1));

 // Shared exclusions: measurement QA, QA-name traffic and admin-linked traffic.
 const excludedSource='excluded_'+tag,excludedCampaign='excluded_'+tag;
 const qaFlag=await addPlayer('Habit flag '+tag);await touch(qaFlag.player,{source:excludedSource,campaign:excludedCampaign},afterTracking(1));await completeDaily(qaFlag.player,firstDay,'mixed',{qa:true});
 const qaName=await addPlayer('QA Habit '+tag);await touch(qaName.player,{source:excludedSource,campaign:excludedCampaign},afterTracking(1));await completeDaily(qaName.player,firstDay,'mixed');
 const adminPlayer=await addPlayer('Habit admin '+tag,{linked:true,admin:true});await touch(adminPlayer.player,{source:excludedSource,campaign:excludedCampaign},afterTracking(1));await completeDaily(adminPlayer.player,firstDay,'mixed');

 // One linked account survives a browser-player merge as one person; two
 // unlinked guests remain two people.
 const identitySource='identity_'+tag,identityCampaign='people_'+tag;
 const target=await addPlayer('Habit account '+tag,{linked:true});
 const sourceGuest=await addPlayer('Habit merge '+tag);
 await touch(target.player,{source:identitySource,campaign:identityCampaign},afterTracking(1));
 await touch(sourceGuest.player,{source:identitySource,campaign:identityCampaign},afterTracking(2));
 await completeDaily(target.player,firstDay,'mixed');
 await completeDaily(sourceGuest.player,nextDay,'mixed');
 await query('SELECT merge_pack1_player($1::uuid,$2::uuid)',[sourceGuest.player,target.player]);
 for(let i=0;i<2;i++){const guest=await addPlayer('Habit guest '+i+' '+tag);await touch(guest.player,{source:identitySource,campaign:identityCampaign},afterTracking(1));await completeDaily(guest.player,firstDay,'mixed');}

 // Mature launch KPI: days 0, +1 and +6 reach 3-in-7. Separate immature
 // cohort verifies rate denominators do not include open windows.
 const kpiSource='kpi_'+tag,kpiCampaign='launch_'+tag,kpi=await addPlayer('Habit KPI '+tag);
 await touch(kpi.player,{source:kpiSource,campaign:kpiCampaign},afterTracking(1));
 await completeDaily(kpi.player,firstDay,'mixed');await completeDaily(kpi.player,nextDay,'powered-cube');await completeDaily(kpi.player,sixthDay,'latest');
 const immatureSource='immature_'+tag,immatureCampaign='open_'+tag,immature=await addPlayer('Habit immature '+tag);
 await touch(immature.player,{source:immatureSource,campaign:immatureCampaign},afterTracking(1));await completeDaily(immature.player,crossDay,'mixed');

 const habitAfter=await handleAdmin(new Request(habitUrl(),{headers:{'x-pack1-auth-session':token}}),query,readJson);
 const cohorts=habitAfter.habit_metrics.cohorts||[],row=(source,campaign)=>cohorts.find(r=>r.source===source&&r.campaign===campaign);
 const afterDirectNone=cohorts.filter(r=>r.source==='direct'&&r.campaign==='(none)').reduce((n,r)=>n+Number(r.cohort_people||0),0);
 assert.equal(afterDirectNone,beforeDirectNone+1,'untagged direct first touch is retained');
 assert.equal(row('reddit_'+tag,'later_'+tag),undefined,'later tagged visit never replaces the first direct touch');
 const sameDayRow=row(sameDaySource,sameDayCampaign);assert.ok(sameDayRow);assert.equal(Number(sameDayRow.cohort_people),1);assert.equal(Number(sameDayRow.next_day_returned),1);
 assert.equal(Number(sameDayRow.three_in_seven_reached),0,'three Dailies on day zero plus one next-day Daily are only two distinct days');
 const crossOnly=await handleAdmin(new Request(habitUrl(crossDay,crossDay),{headers:{'x-pack1-auth-session':token}}),query,readJson);
 assert.equal(Number((crossOnly.habit_metrics.cohorts||[]).find(r=>r.source===crossSource&&r.campaign===crossCampaign)?.cohort_people||0),1,'Daily is bucketed by stored day, not activity timestamp');
 const afterPre=cohorts.filter(r=>r.source==='pre_tracking').reduce((n,r)=>n+Number(r.cohort_people||0),0);assert.equal(afterPre,beforePre+1,'pre-release activity is labeled pre_tracking');
 assert.equal(row(excludedSource,excludedCampaign),undefined,'QA and admin-linked Daily sessions are excluded');
 const identityRow=row(identitySource,identityCampaign);assert.ok(identityRow);assert.equal(Number(identityRow.cohort_people),3,'one merged linked account plus two guests counts as three people');
 const kpiRow=row(kpiSource,kpiCampaign);assert.ok(kpiRow);assert.equal(Number(kpiRow.three_in_seven_mature),1);assert.equal(Number(kpiRow.three_in_seven_reached),1);assert.equal(Number(kpiRow.three_in_seven_rate),100);assert.equal(Number(kpiRow.ever_three_in_seven_people),1);
 const immatureRow=row(immatureSource,immatureCampaign);assert.ok(immatureRow);assert.equal(Number(immatureRow.next_day_mature),0);assert.equal(Number(immatureRow.next_day_immature),1);assert.equal(immatureRow.next_day_rate,null);assert.equal(Number(immatureRow.seven_day_mature),0);assert.equal(Number(immatureRow.three_in_seven_mature),0);
 const health=(habitAfter.habit_metrics.daily_health||[]).find(r=>r.day===sixthDay);assert.ok(health&&Number(health.people)>=1,'daily health reports people at 3+ distinct Daily days in the trailing seven days');

 console.log('PASS: decision math plus launch habit cohorts, exclusions, attribution, maturity, Pacific bucketing and person counting.');
} finally {
 if(players.length)await query('DELETE FROM analytics_events WHERE player_id=ANY($1::uuid[])',['{'+players.join(',')+'}']);
 if(ids.length)await query('UPDATE draft_run_sessions SET measurement_qa=true WHERE id=ANY($1::uuid[])',['{'+ids.join(',')+'}']);
 if(habitPlayers.length)await query('DELETE FROM analytics_events WHERE player_id=ANY($1::uuid[])',['{'+habitPlayers.join(',')+'}']);
 if(habitSessionIds.length)await query('DELETE FROM draft_run_sessions WHERE id=ANY($1::uuid[])',['{'+habitSessionIds.join(',')+'}']);
 if(habitUsers.length){await query('DELETE FROM pack1_admins WHERE auth_user_id=ANY($1::uuid[])',['{'+habitUsers.join(',')+'}']);await query('DELETE FROM account_links WHERE auth_user_id=ANY($1::uuid[])',['{'+habitUsers.join(',')+'}']);await query('DELETE FROM neon_auth."user" WHERE id=ANY($1::uuid[])',['{'+habitUsers.join(',')+'}']);}
 if(habitPlayers.length)await query('DELETE FROM players WHERE id=ANY($1::uuid[])',['{'+habitPlayers.join(',')+'}']);
 await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[user]);await query('DELETE FROM neon_auth.session WHERE token=$1',[token]);
}
