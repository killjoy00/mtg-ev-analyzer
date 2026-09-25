const SETTINGS_KEY='mobile_minimum_supported_versions_v1';

export const MOBILE_STORE_URLS=Object.freeze({
  ios:'https://apps.apple.com/app/id6814318676',
  android:'https://play.google.com/store/apps/details?id=pro.packone.app',
});

function error(message,status,code) {
  return Object.assign(new Error(message),{status,code});
}

function parseMarketingVersion(value) {
  const text=String(value||'').trim();
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(text))throw error('Invalid app version.',400,'mobile_version_invalid');
  const parts=text.split('.').map(Number);
  while(parts.length<3)parts.push(0);
  if(parts.some(part=>!Number.isSafeInteger(part)||part<0))throw error('Invalid app version.',400,'mobile_version_invalid');
  return parts;
}

function parseBuild(value) {
  const text=String(value||'').trim();
  if(!/^\d+$/.test(text))throw error('Invalid app build.',400,'mobile_build_invalid');
  const build=Number(text);
  if(!Number.isSafeInteger(build)||build<0)throw error('Invalid app build.',400,'mobile_build_invalid');
  return build;
}

export function compareMarketingVersions(left,right) {
  const a=parseMarketingVersion(left),b=parseMarketingVersion(right);
  for(let i=0;i<3;i++) {
    if(a[i]!==b[i])return a[i]<b[i]?-1:1;
  }
  return 0;
}

export function normalizeMobileVersionPolicy(value) {
  let parsed;
  try {parsed=typeof value==='string'?JSON.parse(value):value;}
  catch {throw error('Mobile version policy is malformed.',503,'mobile_version_policy_invalid');}
  if(!parsed||typeof parsed!=='object')throw error('Mobile version policy is malformed.',503,'mobile_version_policy_invalid');
  const policy={};
  for(const platform of ['ios','android']) {
    const entry=parsed[platform];
    if(!entry||typeof entry!=='object')throw error('Mobile version policy is malformed.',503,'mobile_version_policy_invalid');
    const marketingVersion=String(entry.marketingVersion||'').trim();
    let build;
    try {
      parseMarketingVersion(marketingVersion);
      build=parseBuild(entry.build);
    } catch {
      throw error('Mobile version policy is malformed.',503,'mobile_version_policy_invalid');
    }
    policy[platform]={marketingVersion,build};
  }
  return policy;
}

export function evaluateMobileVersion(policy,platform,marketingVersion,buildValue) {
  if(!['ios','android'].includes(platform))throw error('Invalid mobile platform.',400,'mobile_platform_invalid');
  const installedVersion=String(marketingVersion||'').trim();
  parseMarketingVersion(installedVersion);
  const installedBuild=parseBuild(buildValue);
  const minimum=policy[platform];
  if(!minimum)throw error('Mobile version policy is unavailable.',503,'mobile_version_policy_invalid');

  const versionComparison=compareMarketingVersions(installedVersion,minimum.marketingVersion);
  const updateRequired=versionComparison<0||(versionComparison===0&&installedBuild<minimum.build);
  return {
    ok:true,
    platform,
    updateRequired,
    installed:{marketingVersion:installedVersion,build:installedBuild},
    minimum:{marketingVersion:minimum.marketingVersion,build:minimum.build},
    storeUrl:MOBILE_STORE_URLS[platform],
  };
}

export async function handleMobileVersionCheck(request,{query,json}) {
  const url=new URL(request.url);
  const platform=String(url.searchParams.get('platform')||'').trim().toLowerCase();
  const marketingVersion=String(url.searchParams.get('version')||'').trim();
  const build=String(url.searchParams.get('build')||'').trim();

  let result;
  try {result=await query('SELECT value FROM settings WHERE key=$1',[SETTINGS_KEY]);}
  catch(cause) {throw Object.assign(error('Mobile version policy is temporarily unavailable.',503,'mobile_version_policy_unavailable'),{cause});}
  const raw=result.rows[0]?.value;
  if(!raw)throw error('Mobile version policy is temporarily unavailable.',503,'mobile_version_policy_unavailable');
  const policy=normalizeMobileVersionPolicy(raw);
  return json(evaluateMobileVersion(policy,platform,marketingVersion,build));
}

export {SETTINGS_KEY as MOBILE_VERSION_SETTINGS_KEY};
