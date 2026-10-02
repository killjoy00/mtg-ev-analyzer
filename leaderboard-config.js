// Public Pack One API endpoints. Production account/gameplay traffic goes through
// the first-party gateway so browser account credentials remain cookies scoped
// to packone.pro. Other production hosts keep the direct production origins
// because Secure production cookies are only first-party on the apex.
// Only the apex host uses first-party Pack One cookies. Environment selection
// is static deployment configuration: localhost uses the isolated Auth QA
// provider and the development Functions branch, so local testing can never
// create production players or events; every non-local host uses production.
// Query/hash/storage state never selects an environment.
const firstParty = location.hostname === 'packone.pro';
const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const direct = local
  ? {
      url: 'https://br-twilight-hill-ayffyd2b-pack1api.compute.c-5.us-east-2.aws.neon.tech',
      growthUrl: 'https://br-twilight-hill-ayffyd2b-pack1growth.compute.c-5.us-east-2.aws.neon.tech',
      draftRunUrl: 'https://br-twilight-hill-ayffyd2b-draftrunapi.compute.c-5.us-east-2.aws.neon.tech',
    }
  : {
      url: 'https://br-orange-feather-ayps8kep-pack1api.compute.c-5.us-east-2.aws.neon.tech',
      growthUrl: 'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech',
      draftRunUrl: 'https://br-orange-feather-ayps8kep-draftrunapi.compute.c-5.us-east-2.aws.neon.tech',
    };
window.PACK1_API = {
  firstParty,
  authBase: local
    ? 'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth'
    : 'https://ep-young-hall-ayl0754j.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth',
  url: firstParty ? 'https://api.packone.pro/legacy' : direct.url,
  growthUrl: firstParty ? 'https://api.packone.pro/growth' : direct.growthUrl,
  draftRunUrl: firstParty ? 'https://api.packone.pro/draft' : direct.draftRunUrl,
};
