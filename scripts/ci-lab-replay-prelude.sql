-- Disposable CI database only, in the same transaction as the complete 0085.
-- Do not modify the immutable release migration or production migration ledger.
DO $replay$
BEGIN
  IF to_regclass('public.pack1_lab_task_jobs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS pack1_lab_task_immutable ON public.pack1_lab_task_jobs;
  END IF;
END
$replay$;
