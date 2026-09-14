// Older APIs did not send a run length. Preserve their ten-pick presentation
// while newer responses (including historical challenges) state it explicitly.
export function draftRunLength(run) {
  if([8,10].includes(Number(run?.run_length)))return Number(run.run_length);
  if(run?.complete&&[8,10].includes(run.answers?.length))return run.answers.length;
  return 10;
}
