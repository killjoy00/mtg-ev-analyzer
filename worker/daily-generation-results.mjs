export const DAILY_ENVIRONMENTS=['mixed','powered-cube','latest'];

export function dailyGenerationErrorClass(error) {
  const status=Number(error?.status);
  if(status===503)return 'availability_error';
  if(Number.isInteger(status)&&status>=400&&status<500)return 'request_error';
  if(Number.isInteger(status)&&status>=500&&status<600)return 'server_error';
  return 'internal_error';
}

export async function generateDailyEnvironmentResults(day,ensure,{now=Date.now}={}) {
  const results=[];
  for(const environment of DAILY_ENVIRONMENTS) {
    const started=now();
    try {
      const {created}=await ensure(day,environment);
      results.push({environment,status:created?'created':'already_exists',duration_ms:Math.max(0,now()-started)});
    } catch(error) {
      results.push({
        environment,
        status:'failed',
        error_class:dailyGenerationErrorClass(error),
        duration_ms:Math.max(0,now()-started),
      });
    }
  }
  return results;
}
