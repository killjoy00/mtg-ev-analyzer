// Public Pack One API endpoints. Production account/gameplay traffic goes through
// the first-party gateway so browser account credentials remain cookies scoped
// to packone.pro. Local development keeps the direct origins because Secure
// production cookies are intentionally unavailable over localhost.
const firstParty = ['packone.pro','www.packone.pro'].includes(location.hostname);
window.PACK1_API = {
  firstParty,
  url: 'https://br-orange-feather-ayps8kep-pack1api.compute.c-5.us-east-2.aws.neon.tech',
  growthUrl: firstParty
    ? 'https://api.packone.pro/growth'
    : 'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech',
  draftRunUrl: firstParty
    ? 'https://api.packone.pro/draft'
    : 'https://br-orange-feather-ayps8kep-draftrunapi.compute.c-5.us-east-2.aws.neon.tech',
};
