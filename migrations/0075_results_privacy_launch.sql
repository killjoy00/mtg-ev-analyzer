-- Owner-authorized activation after the 0074 backend has been verified live.
-- Each environment records its own actual activation time. Replays preserve it.
DO $launch$
DECLARE previous timestamptz;
BEGIN
 SELECT launch_at INTO previous FROM results_launch WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESULTS_LAUNCH_SETTING_REQUIRED'; END IF;
 IF previous IS NULL THEN
   UPDATE results_launch SET launch_at=clock_timestamp() WHERE singleton;
 ELSIF previous>clock_timestamp() THEN
   RAISE EXCEPTION 'RESULTS_LAUNCH_ALREADY_SCHEDULED';
 END IF;
END $launch$;
