const PROD_AUTH_BASE='https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
const QA_AUTH_BASE='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const PROD_RESET_DESTINATION='https://packone.pro/reset-password/';
const QA_RESET_DESTINATION='http://localhost:4173/reset-password/';
const PROD_ORIGINS=[
  'https://packone.pro',
  'https://api.packone.pro',
  'https://magic.planitnow.us',
];
const LOCAL_ORIGINS=['http://localhost:4173','http://127.0.0.1:4173'];

export {PROD_AUTH_BASE,QA_AUTH_BASE,PROD_RESET_DESTINATION,QA_RESET_DESTINATION,PROD_ORIGINS,LOCAL_ORIGINS};

export function accountRuntimeConfig(env=process.env) {
  const mode=String(env.PACK1_AUTH_ENV||'production').trim().toLowerCase();
  const local=env.PACK1_ALLOW_LOCALHOST==='1';
  if(mode!=='production'&&mode!=='qa')throw Error('Invalid Pack One Auth environment.');
  if(mode==='qa'&&!local)throw Error('QA Auth requires explicit localhost application mode.');
  return {
    mode,
    authBase:mode==='qa'?QA_AUTH_BASE:PROD_AUTH_BASE,
    providerOrigin:mode==='qa'?'http://localhost:4173':'https://packone.pro',
    resetDestination:mode==='qa'?QA_RESET_DESTINATION:PROD_RESET_DESTINATION,
    allowedOrigins:new Set([...PROD_ORIGINS,...(local?LOCAL_ORIGINS:[])]),
  };
}
