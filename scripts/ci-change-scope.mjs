import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CI_SELECTION_PATHS=new Set([
  '.github/workflows/test.yml',
  '.github/workflows/e2e.yml',
  '.github/scripts/publication-pr-checks.mjs',
  'scripts/ci-change-scope.mjs',
  'scripts/run-js-tests.mjs',
  'tests/ci-change-scope.test.mjs',
  'tests/ci-workflow-policy.test.mjs',
  'tests/browser-replay-hydration.test.mjs',
  'tests/publication-pr-checks.test.mjs',
]);

const cleanPath=value=>String(value||'').replace(/^\.\//,'');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);

function uniqueRegistry(rows,label) {
  assert.ok(Array.isArray(rows),label+' must be an array');
  const map=new Map();
  for(const row of rows) {
    assert.ok(isObject(row),label+' entries must be objects');
    assert.match(String(row.slug||''),SLUG,label+' entry has invalid slug');
    assert.ok(!map.has(row.slug),label+' has duplicate slug '+row.slug);
    map.set(row.slug,row);
  }
  return map;
}

function changedRegistrySlugs(before,after,label) {
  const left=uniqueRegistry(before,label);
  const right=uniqueRegistry(after,label);
  const slugs=[...new Set([...left.keys(),...right.keys()])].sort();
  return slugs.filter(slug=>!same(left.get(slug),right.get(slug))).map(slug=>({
    slug,before:left.get(slug)||null,after:right.get(slug)||null,
  }));
}

function exactChangedPaths(paths,required,optional=[]) {
  const actual=new Set(paths.map(cleanPath));
  if(required.some(item=>!actual.has(item)))return false;
  const allowed=new Set([...required,...optional]);
  return [...actual].every(item=>allowed.has(item));
}

export function detectPublicationChange(paths,{campaignBefore,campaignAfter,creatorBefore,creatorAfter,
  headHas=()=>false,baseHas=()=>false}={}) {
  const changed=paths.map(cleanPath);
  const campaignRegistry=changed.includes('campaign-links.json');
  const creatorRegistry=changed.includes('creator-challenges.json');
  if(campaignRegistry===creatorRegistry)return null;

  if(campaignRegistry) {
    if(!campaignBefore||!campaignAfter)return null;
    const delta=changedRegistrySlugs(campaignBefore,campaignAfter,'campaign-links.json');
    if(delta.length!==1)return null;
    const {slug,before,after}=delta[0];
    const route='go/'+slug+'/index.html';
    if(before&&after)return null; // attribution changes are application changes, not generated publication.
    const action=after?'publish':'retire';
    if(action==='publish'&&!headHas(route))return null;
    if(action==='retire'&&headHas(route))return null;
    if(!exactChangedPaths(changed,['campaign-links.json',route]))return null;
    return {kind:'campaign',slug,action,allowedPaths:['campaign-links.json',route]};
  }

  if(!creatorBefore||!creatorAfter)return null;
  const delta=changedRegistrySlugs(creatorBefore,creatorAfter,'creator-challenges.json');
  if(delta.length!==1)return null;
  const {slug,before,after}=delta[0];
  const route='creator/'+slug+'/index.html';
  const card='creator/'+slug+'/creator-card.png';
  if(!after)return null; // creator retirement keeps a neutral tombstone entry.
  const action=after.status==='retired'?'retire':after.status==='published'?'publish':null;
  if(!action)return null;
  if(before) {
    if(before.id!==after.id||before.slug!==after.slug)return null;
    if(action==='publish'||before.status!=='published')return null;
  }
  if(!headHas(route))return null;
  if(action==='publish'&&!headHas(card))return null;
  if(action==='retire'&&headHas(card))return null;
  const optional=action==='retire'?[card]:[];
  if(!exactChangedPaths(changed,['creator-challenges.json',route,...(action==='publish'?[card]:[])],optional))return null;
  if(action==='retire'&&baseHas(card)&&!changed.includes(card))return null;
  return {kind:'creator',slug,action,allowedPaths:['creator-challenges.json',route,...optional]};
}

function mobilePath(p) {
  return p.startsWith('mobile/')
    || /^docs\/(?:mobile-|android-)/.test(p)
    || p==='docs/parity.md'
    || /^\.github\/workflows\/(?:mobile|android-|ios-)/.test(p)
    || p==='.github/workflows/google-play-access.yml'
    || /^\.github\/(?:android-|ios-|app-store-).+\.txt$/.test(p)
    || /^\.github\/scripts\/app-store-.+\.mjs$/.test(p);
}
function docsPath(p) {
  return p==='README.md'||p.endsWith('.md')||p.startsWith('docs/');
}
function ciPath(p) {
  return p.startsWith('.github/workflows/')||p.startsWith('.github/scripts/')
    || /^tests\/.*(?:workflow|release|ci).*\.test\.mjs$/.test(p)
    || /^scripts\/.*(?:workflow|release|scope).*\.mjs$/.test(p);
}
function heavyPath(p) {
  return p.startsWith('data/')||p.startsWith('corpus/')||p.startsWith('research/')
    || /^scripts\/(?:r2_replay_shards\.sh|hydrate-replay-shards\.sh|build_replays\.py|build_path_model\.py|model_training\.py|eval_model\.py|scoring_experiment\.py|validate_dataset\.py)$/.test(p)
    || /^(?:path-model|scoring|draft-run-difficulty|draft-run-policy|daily-selection)\.mjs$/.test(p)
    || p==='worker/path-model.mjs'
    || /^tests\/(?:consensus-audit|path-model-distribution|scoring-distribution)\.test\.mjs$/.test(p)
    || /^tests\/test_.*(?:replay|path_model|model|scoring|dataset|data_health|corpus|outcome|frozen|trophy).*\.py$/.test(p);
}
function staticPath(p) {
  if(p.startsWith('creator/')||p.startsWith('go/'))return false;
  return /\.(?:html|css|svg|png|jpe?g|webp|ico)$/.test(p)
    || ['ads.txt','robots.txt','sitemap.xml','manifest.webmanifest'].includes(p);
}
function backendPath(p) {
  return p.startsWith('worker/')||p.startsWith('migrations/')
    || p==='scripts/build-neon-functions.mjs'||p==='scripts/verify-neon-schema.mjs';
}
function appPath(p) {
  return backendPath(p)||p.startsWith('admin/')||p.startsWith('tests/')||p.startsWith('scripts/')
    || /\.(?:mjs|js|json)$/.test(p);
}

function browserGroupsForPath(p) {
  const groups=new Set();
  const add=(...values)=>values.forEach(value=>groups.add(value));
  if(/^tests\/(?:e2e|home-today-e2e|home-auth-hydration-e2e)\.mjs$/.test(p))add('core');
  if(/^tests\/(?:sets|practice|practice-hub|practice-access|profile|draft-run)-e2e\.mjs$/.test(p))add('gameplay');
  if(/^tests\/(?:account|auth-context|email-verification|patreon-activation|password-recovery|credential-management|account-deletion)-e2e\.mjs$/.test(p))add('account');
  if(p==='tests/ads-e2e.mjs')add('ads');
  if(p==='tests/admin-e2e.mjs')add('admin');
  if(p==='tests/corpus-readiness-e2e.mjs')add('corpus');
  if(groups.size)return groups;

  if(p.startsWith('admin/')||/(?:^|\/)(?:user-admin|admin-|campaign-link)/.test(p))add('admin');
  if(/(?:^|\/)(?:ads?|monetization)(?:[.-]|$)/.test(p))add('ads','core');
  if(/(?:account|auth|credential|password|patreon|membership|subscription|identity|growth)/.test(p))add('account','core');
  if(/(?:creator|campaign)/.test(p))add('gameplay','admin','core');
  if(/(?:draft-run|practice|cube|daily|gameplay|scoring|leaderboard|profile|share|today|home|sets|product)/.test(p))add('gameplay','core');
  if(/(?:corpus|snapshot|serving|source-|trophy)/.test(p))add('corpus','gameplay');

  if(groups.size)return groups;
  if(p.startsWith('scripts/')||p.startsWith('tests/'))return groups;
  if(backendPath(p))return new Set(['*']);
  if(/\.(?:mjs|js|json)$/.test(p))return new Set(['*']);
  return groups;
}

export function classifyChangedPaths(paths,{publication=null,forceProfile=null}={}) {
  const changed=[...new Set(paths.map(cleanPath).filter(Boolean))];
  if(forceProfile) {
    assert.ok(['broad','heavy','standard','static','ci','mobile','docs','publication'].includes(forceProfile));
    return scopeFromProfile(forceProfile,{reason:'forced '+forceProfile,publication});
  }
  if(changed.length===0)return scopeFromProfile('broad',{reason:'empty diff falls back to broad validation'});

  if(publication&&exactChangedPaths(changed,publication.allowedPaths))
    return scopeFromProfile('publication',{reason:'exact validated '+publication.kind+' '+publication.action,publication});

  const flags={docs:false,mobile:false,ci:false,static:false,app:false,backend:false,heavy:false,unknown:false,ciSelection:false,browserGroups:new Set()};
  for(const p of changed) {
    if(CI_SELECTION_PATHS.has(p)){flags.ciSelection=true;continue;}
    if(mobilePath(p)){flags.mobile=true;continue;}
    if(heavyPath(p)){flags.heavy=true;continue;}
    if(docsPath(p)){flags.docs=true;continue;}
    if(staticPath(p)){flags.static=true;continue;}
    if(ciPath(p)){flags.ci=true;continue;}
    if(backendPath(p)){flags.backend=true;flags.app=true;for(const group of browserGroupsForPath(p))flags.browserGroups.add(group);continue;}
    if(appPath(p)){flags.app=true;for(const group of browserGroupsForPath(p))flags.browserGroups.add(group);continue;}
    if(p==='.gitignore'){flags.docs=true;continue;}
    if(p==='package.json'||/^package-lock\.json$/.test(p)){flags.ciSelection=true;continue;}
    flags.unknown=true;
  }

  if(flags.unknown||flags.ciSelection)
    return scopeFromProfile('broad',{reason:flags.unknown?'unknown path requires broad validation':'CI selection/shared execution changed',flags});
  if(flags.heavy)
    return scopeFromProfile('heavy',{reason:'replay/model/scoring/data change',flags});
  if(flags.app||flags.backend)
    return scopeFromProfile('standard',{reason:'shared application/backend change',flags});
  if(flags.ci&&(flags.static||flags.mobile))
    return scopeFromProfile('standard',{reason:'mixed workflow and product/static change',flags});
  if(flags.static)
    return scopeFromProfile('static',{reason:'static presentation change',flags});
  if(flags.ci)
    return scopeFromProfile('ci',{reason:'workflow/helper change',flags});
  if(flags.mobile)
    return scopeFromProfile('mobile',{reason:'native mobile/release-only change',flags});
  if(flags.docs)
    return scopeFromProfile('docs',{reason:'documentation-only change',flags});
  return scopeFromProfile('broad',{reason:'unclassified change falls back to broad validation',flags});
}

function scopeFromProfile(profile,{reason='',publication=null,flags={}}={}) {
  const broad=profile==='broad',heavy=profile==='heavy';
  const browserGroups=flags.browserGroups instanceof Set?[...flags.browserGroups].sort():[];
  const selectedFull=browserGroups.includes('*');
  return {
    profile,reason,
    publication_kind:publication?.kind||'',
    publication_slug:publication?.slug||'',
    publication_action:publication?.action||'',
    hydrate_replays:broad||heavy,
    audit_datasets:broad||heavy,
    build_bundles:broad||heavy||Boolean(flags.backend),
    browser_groups:selectedFull?'*':browserGroups.join(','),
    browser_mode:profile==='publication'?'publication':profile==='static'?'core':
      ['heavy','broad'].includes(profile)||selectedFull?'full':
      profile==='standard'&&browserGroups.length?'selected':'none',
  };
}

function readGitText(ref,file) {
  try{return execFileSync('git',['show',ref+':'+file],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
  catch(error){if(error?.status===128)return null;throw error;}
}
function readGitJson(ref,file) {
  const text=readGitText(ref,file);
  return text===null?null:JSON.parse(text);
}
function gitHas(ref,file) {
  try{execFileSync('git',['cat-file','-e',ref+':'+file],{stdio:'ignore'});return true;}
  catch(error){if(error?.status===128)return false;throw error;}
}
function changedFiles(base,head) {
  return execFileSync('git',['diff','--name-only',base,head],{encoding:'utf8'})
    .split('\n').map(cleanPath).filter(Boolean);
}
function appendOutputs(file,scope) {
  const lines=Object.entries(scope).filter(([,value])=>['string','boolean','number'].includes(typeof value))
    .map(([key,value])=>key+'='+String(value).replace(/\n/g,' ')+'\n').join('');
  fs.appendFileSync(file,lines);
}
function parseArgs(argv) {
  const result={};
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if(arg==='--base'||arg==='--head'||arg==='--github-output'||arg==='--force') {
      if(!argv[i+1])throw Error(arg+' requires a value');
      result[arg.slice(2).replace(/-/g,'_')]=argv[++i];
      continue;
    }
    throw Error('Unknown argument: '+arg);
  }
  return result;
}

export function classifyRepositoryDiff({base,head}) {
  assert.match(base,/^[a-f0-9]{40}$/i);
  assert.match(head,/^[a-f0-9]{40}$/i);
  const paths=changedFiles(base,head);
  let publication=null;
  if(paths.includes('campaign-links.json')||paths.includes('creator-challenges.json')) {
    publication=detectPublicationChange(paths,{
      campaignBefore:readGitJson(base,'campaign-links.json'),
      campaignAfter:readGitJson(head,'campaign-links.json'),
      creatorBefore:readGitJson(base,'creator-challenges.json'),
      creatorAfter:readGitJson(head,'creator-challenges.json'),
      headHas:file=>gitHas(head,file),
      baseHas:file=>gitHas(base,file),
    });
  }
  return {...classifyChangedPaths(paths,{publication}),changed_files:paths};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=parseArgs(process.argv.slice(2));
  let scope;
  try {
    if(args.force)scope=classifyChangedPaths([],{forceProfile:args.force});
    else scope=classifyRepositoryDiff({base:args.base,head:args.head});
  } catch(error) {
    console.error('::warning::CI change classifier failed; using broad validation: '+String(error?.message||error));
    scope=scopeFromProfile('broad',{reason:'classifier failure'});
  }
  console.log(JSON.stringify(scope,null,2));
  if(args.github_output)appendOutputs(args.github_output,scope);
}
