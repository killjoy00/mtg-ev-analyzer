// Public Pack One API endpoints. Production account/gameplay traffic goes through
// the first-party gateway so browser account credentials remain cookies scoped
// to packone.pro. Local development keeps the direct origins because Secure
// production cookies are intentionally unavailable over localhost.
// Only the apex host is first-party: the gateway and the account worker both
// trust https://packone.pro alone, and www redirects here before any script runs.
const firstParty = location.hostname === 'packone.pro';
window.PACK1_API = {
  firstParty,
  url: firstParty
    ? 'https://api.packone.pro/legacy'
    : 'https://br-orange-feather-ayps8kep-pack1api.compute.c-5.us-east-2.aws.neon.tech',
  growthUrl: firstParty
    ? 'https://api.packone.pro/growth'
    : 'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech',
  draftRunUrl: firstParty
    ? 'https://api.packone.pro/draft'
    : 'https://br-orange-feather-ayps8kep-draftrunapi.compute.c-5.us-east-2.aws.neon.tech',
};
