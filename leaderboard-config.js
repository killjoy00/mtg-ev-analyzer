// Public Pack One API endpoints. Production account/gameplay traffic goes through
// the first-party gateway so browser account credentials remain cookies scoped
// to packone.pro. Local development keeps the direct origins because Secure
// production cookies are intentionally unavailable over localhost.
// Only the apex host uses first-party Pack One cookies. Auth-provider selection
// is static deployment configuration: localhost uses the isolated Auth QA
// provider, while every non-local host uses production. Query/hash/storage state
// never selects an Auth environment.
const firstParty = location.hostname === 'packone.pro';
const localAuth = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
window.PACK1_API = {
  firstParty,
  authBase: localAuth
    ? 'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth'
    : 'https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth',
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
