// Shadows inherited utility functions on disposable preview branches only.
// No route, method, credential or body can enable their historical behavior.
export function closedOrigin(commit) {
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('A release revision is required.');
  return {fetch() {return Response.json({error:'Endpoint disabled in this preview.',release_commit:commit},{status:403,headers:{'cache-control':'no-store'}});}};
}
