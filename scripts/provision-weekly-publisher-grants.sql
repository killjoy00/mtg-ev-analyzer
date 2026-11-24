-- Run only in the separately approved protected private publisher setup.
-- Provision packone_weekly_publisher as a dedicated LOGIN with NOINHERIT,
-- no admin role memberships, no ownership and a privately managed password.
-- No credential values belong in this file, public logs, or the public feed.
DO $body$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='packone_weekly_publisher';
 IF NOT FOUND OR NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
   OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member WHERE member.rolname='packone_weekly_publisher')
 THEN RAISE EXCEPTION 'WEEKLY_ROLE_NOT_SCOPED'; END IF;
END $body$;
GRANT USAGE ON SCHEMA public TO packone_weekly_publisher;
GRANT SELECT(mode,set_id,details_json,challenge_date,player_id,score) ON scores TO packone_weekly_publisher;
GRANT SELECT(id,display_name,username_owned,public_identity_hidden_at,profile_public,profile_key,showcase_achievement) ON players TO packone_weekly_publisher;
GRANT SELECT(auth_user_id,player_id) ON account_links TO packone_weekly_publisher;
GRANT SELECT(blocker_player_id,target_player_id) ON public_identity_blocks TO packone_weekly_publisher;
GRANT SELECT(id,set_name,start_date,end_date) ON draft_run_seasons TO packone_weekly_publisher;
GRANT SELECT(day,environment,puzzle_ids) ON draft_run_schedules TO packone_weekly_publisher;
GRANT SELECT(puzzle_id,set_id,pick_number,payload) ON draft_run_verified_puzzles TO packone_weekly_publisher;
GRANT SELECT(id,day,environment,daily_account_id,player_id,created_at,measurement_qa) ON draft_run_sessions TO packone_weekly_publisher;
GRANT SELECT(session_id,puzzle_id,selected_id,round,revision,outcome) ON draft_run_decision_observations TO packone_weekly_publisher;
GRANT SELECT(singleton,launch_at) ON results_launch TO packone_weekly_publisher;
GRANT SELECT(week_end,title,state,image_sha256,image_width,image_height,admitted_at,public_url,published_at) ON patreon_weekly_runs TO packone_weekly_publisher;
GRANT INSERT(week_end,title,state,image_sha256,image_width,image_height),UPDATE(state,last_status) ON patreon_weekly_runs TO packone_weekly_publisher;
GRANT EXECUTE ON FUNCTION pack1_patreon_weekly_name(uuid),pack1_patreon_weekly_admit(date,jsonb),pack1_patreon_weekly_finish(date,text,timestamptz) TO packone_weekly_publisher;
-- Deliberately no Auth user/email, pending-name table, deletion records,
-- arbitrary DML on scores, results_publications or removal tasks.
