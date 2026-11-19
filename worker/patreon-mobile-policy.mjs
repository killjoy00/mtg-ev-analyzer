// Exact provider-scoped native routes. Keep this module free of runtime/DB imports
// so the edge allowlist and the origin dispatcher use the identical contract.
export function nativePatreonAction(path,method) {
  if(method==='GET'&&path==='/v1/patreon/mobile/status')return 'status';
  if(method==='POST'&&path==='/v1/patreon/mobile/connect')return 'connect';
  if(method==='POST'&&path==='/v1/patreon/mobile/refresh')return 'refresh';
  if(method==='POST'&&path==='/v1/patreon/mobile/disconnect')return 'disconnect';
  return null;
}

export function nativePatreonState(value) {
  return /^m_[a-f0-9]{64}$/.test(String(value||''));
}

export function validPatreonState(value) {
  return /^[a-f0-9]{64}$/.test(String(value||''))||nativePatreonState(value);
}

export function patreonReturnUrl(status,{mobile=false}={}) {
  const allowed=new Set(['connected','cancelled','expired','unavailable','identity-mismatch','conflict','error']);
  const outcome=allowed.has(status)?status:'error';
  const target=new URL(mobile?'https://packone.pro/mobile-membership-complete/':'https://packone.pro/');
  target.searchParams.set(mobile?'result':'patreon',outcome);
  return target.toString();
}
