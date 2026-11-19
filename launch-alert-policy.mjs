// Shared by the gateway and watcher: changing tail retention must not change
// enforcement or make fast successes look fully retained.
export const SLOW_REQUEST_MS=5000;
export const SLOW_QUOTA_MS=1000;
export const TAIL_SAMPLING_VERSION=1;
export const RATE_LIMIT_CLASS_HEADER='x-pack1-rate-limit-class';
export const AUTH_LIMIT_CLASS='player_auth';

export function productionSampleRate(status,{duration_ms=0,quota_ms=0}={}) {
  return status>=400||duration_ms>SLOW_REQUEST_MS||quota_ms>SLOW_QUOTA_MS?1:.1;
}

export function confirmedAuthLimit(path,method,status,value) {
  return status===429&&method==='POST'&&
    /^\/growth\/v1\/mobile\/account\/(?:signin|signup)$/.test(path)&&value===AUTH_LIMIT_CLASS;
}

export function alertSeverity(condition,{persistent=false}={}) {
  if(['authentication_429','worker_daily_usage','worker_daily_headroom',
    'neon_compute_billing_period_usage','neon_egress_billing_period_usage'].includes(condition))return 'warning';
  if(['slow_requests','slow_quota'].includes(condition))return persistent?'alert':'warning';
  return 'alert';
}
