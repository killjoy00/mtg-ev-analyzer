// Only public invitation identities cross the authentication return boundary.
// Never persist or accept an arbitrary destination URL.
export function sharedRunId(value) {
  return typeof value==='string'&&/^[a-f0-9]{24}$/.test(value)?value:null;
}

export function sharedRunInvitationId(href) {
  const params=new URL(href).searchParams;
  if(params.get('game')!=='draft-run'||['run','creator','board','custom'].some(key=>params.has(key)))return null;
  const modern=params.get('shared'),legacy=params.get('challenge');
  if(modern&&legacy&&modern!==legacy)return null;
  return sharedRunId(modern||legacy);
}

export function sharedRunInvitationPath(id) {
  const valid=sharedRunId(id);
  if(!valid)throw Error('Invalid shared run.');
  return '/?game=draft-run&shared='+valid;
}

export function sharedRunAppPath(id) {
  const valid=sharedRunId(id);
  if(!valid)throw Error('Invalid shared run.');
  return '/open/shared/?id='+valid;
}
