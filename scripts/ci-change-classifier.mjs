import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const exactPublication = paths => {
  const normalized=[...new Set(paths)].sort();
  if(normalized.includes('campaign-links.json')) {
    const routes=normalized.filter(path=>/^go\/[^/]+\/index\.html$/.test(path));
    if(routes.length===1&&normalized.length===2) return {kind:'campaign',slug:routes[0].split('/')[1]};
  }
  if(normalized.includes('creator-challenges.json')) {
    const routes=normalized.filter(path=>/^creator\/[^/]+\/index\.html$/.test(path));
    if(routes.length===1) {
      const slug=routes[0].split('/')[1];
      const allowed=new Set(['creator-challenges.json',`creator/${slug}/index.html`,`creator/${slug}/creator-card.png`,`creator/${slug}/creator-card-square.png`]);
      if(normalized.length>=2&&normalized.length<=4&&normalized.every(path=>allowed.has(path))) return {kind:'creator',slug};
    }
  }
  return null;
};

const mobilePatterns=[
  /^mobile\//,
  /^docs\/(?:mobile-|android-)/,
  /^docs\/parity\.md$/,
  /^\.github\/workflows\/(?:mobile|android-|ios-|google-play-access)/,
  /^\.github\/(?:android-|ios-|app-store-).+\.txt$/,
  /^\.github\/scripts\/app-store-.+\.mjs$/,
];
const isMobile=path=>path==='.gitignore'||mobilePatterns.some(pattern=>pattern.test(path));
const selectionInfrastructure=new Set([
  '.github/workflows/test.yml','.github/workflows/e2e.yml','.github/workflows/backend-gate.yml','.github/scripts/publication-pr-checks.mjs',
  'scripts/ci-change-classifier.mjs','scripts/ci-publication-validate.mjs','scripts/check-creator-social-card.py','scripts/run-js-tests.mjs',
  'scripts/backend-gate-scope.mjs','scripts/backend-gate-map.json',
  'scripts/run-browser-tests.mjs','scripts/hydrate-replay-shards.sh','scripts/hydrate-browser-replays.sh','scripts/r2_replay_shards.sh',
  'tests/ci-change-classifier.test.mjs','tests/ci-publication-validate.test.mjs','tests/ci-workflow-policy.test.mjs','tests/workflow-block-scalars.test.mjs',
  'tests/backend-gate-scope.test.mjs','tests/publication-pr-checks.test.mjs',
  'tests/publication-route-e2e.mjs','tests/browser-replay-hydration.test.mjs','tests/browser-test-selection.test.mjs',
]);
const isDependency=path=>/^(?:package(?:-lock)?\.json|requirements(?:-[^/]+)?\.txt|pyproject\.toml|uv\.lock)$/.test(path);
const isDocs=path=>path==='README.md'||path==='MONETIZATION.md'||path.startsWith('docs/')||/\.md$/i.test(path);
const isPresentation=path=>{
  if(/^creator\//.test(path)||/^go\//.test(path))return false;
  if(/\.(?:html|css|png|jpe?g|svg|ico|webp)$/i.test(path))return true;
  return /^(?:about|contact|privacy|terms|how-it-works|learn|sets|methodology|disclosure|\.well-known)\//.test(path)
    ||['CNAME','_config.yml','robots.txt','sitemap.xml','ads.txt','ads.txt.example'].includes(path);
};
const heavyRoot=new Set([
  'scoring.mjs','path-model.mjs','replay-data.mjs','draft-run-difficulty.mjs','draft-run-policy.mjs','daily-selection.mjs',
  'model-versions.json','corpus-components.mjs','corpus-quality.mjs','serving-quality.mjs',
]);
const heavyToken=/(?:replay|scor|model|corpus|dataset|troph|traditional|holdout|pick_value|contextual_value|grading_curve|selection|v5[_-])/i;
const isHeavy=path=>heavyRoot.has(path)||/^(?:data|corpus|scoring|research)\//.test(path)
  ||(/^(?:worker|scripts|tests)\//.test(path)&&heavyToken.test(path));
const isWorkflow=path=>/^\.github\/(?:workflows\/|scripts\/|.+-request\.(?:json|txt)$)/.test(path);
const isKnownApp=path=>/\.(?:mjs|js|cjs|py|sql|sh|json)$/i.test(path)
  ||/^(?:worker|scripts|tests|migrations|admin|analytics|edge|open|results)\//.test(path);
const browserGroupForPath=path=>{
  if(/(?:^|\/)(?:account|auth|credential|password|reset-password|membership|patreon|apple)/i.test(path))return 'account';
  if(/(?:^|\/)(?:practice|custom-coverage)/i.test(path))return 'practice';
  if(/(?:^|\/)(?:profile|progression)/i.test(path))return 'profile';
  if(/(?:^|\/)(?:daily|home-today|today-status)/i.test(path))return 'daily';
  if(/(?:^|\/)(?:draft-run|gameplay|decision-clock)/i.test(path))return 'draft_run';
  if(/(?:^|\/)admin(?:\/|-)|admin-api-contract/i.test(path))return 'admin';
  if(/(?:^|\/)ads?(?:\.|\/|-)/i.test(path))return 'ads';
  return null;
};

export function classifyChanges(paths,{forceFull=false}={}) {
  const changed=[...new Set(paths.filter(Boolean))].sort();
  if(forceFull||changed.length===0)return result('full',changed,{reason:forceFull?'explicit full validation':'empty or unavailable diff'});
  const publication=exactPublication(changed);
  if(publication)return result('publication',changed,{publication,reason:'exact generated publication diff candidate'});
  if(changed.some(path=>selectionInfrastructure.has(path)||isDependency(path)))return result('full',changed,{reason:'CI selection/shared execution/dependency change'});
  if(changed.some(isHeavy))return result('heavy',changed,{reason:'replay/model/scoring/data change',ciContracts:changed.some(isWorkflow)});
  const categories=new Set();
  for(const path of changed){
    if(isMobile(path)){categories.add('mobile');continue;}
    if(isDocs(path)){categories.add('docs');continue;}
    if(isPresentation(path)){categories.add('presentation');continue;}
    if(isWorkflow(path)){categories.add('ci');continue;}
    if(isKnownApp(path)){categories.add('app');continue;}
    categories.add('unknown');
  }
  if(categories.has('unknown'))return result('full',changed,{reason:'unknown path requires broad validation'});
  if(categories.has('app')){
    const appPaths=changed.filter(path=>!isDocs(path)&&!isPresentation(path)&&!isWorkflow(path)&&!isMobile(path));
    const groups=[...new Set(appPaths.map(browserGroupForPath).filter(Boolean))].sort();
    const unmapped=appPaths.filter(path=>!browserGroupForPath(path));
    const broadenBrowser=unmapped.length||categories.has('presentation');
    return result('app',changed,{reason:broadenBrowser?'shared/mixed application change':'domain-scoped application change',
      browserGroups:broadenBrowser?[]:groups,ciContracts:categories.has('ci')});
  }
  if(categories.has('presentation'))return result('presentation',changed,{reason:'static presentation change',ciContracts:categories.has('ci')});
  if(categories.has('ci'))return result('ci',changed,{reason:'workflow/helper-only change'});
  if(categories.has('mobile'))return result('mobile',changed,{reason:'native mobile/release-only change'});
  return result('docs',changed,{reason:'documentation-only change'});
}

function result(plan,paths,{publication=null,reason,browserGroups=[],ciContracts}={}) {
  const table={
    full:{unit:'full',browser:'full',hydrate:true,dataset:true,bundles:true,ciContracts:true},
    heavy:{unit:'full',browser:'full',hydrate:true,dataset:true,bundles:true,ciContracts:false},
    app:{unit:'full',browser:browserGroups.length?'groups':'full',hydrate:false,dataset:false,bundles:true,ciContracts:false},
    publication:{unit:'publication',browser:'publication',hydrate:false,dataset:false,bundles:false,ciContracts:false},
    presentation:{unit:'presentation',browser:'presentation',hydrate:false,dataset:false,bundles:false,ciContracts:false},
    ci:{unit:'ci',browser:'none',hydrate:false,dataset:false,bundles:false,ciContracts:true},
    mobile:{unit:'mobile',browser:'none',hydrate:false,dataset:false,bundles:false,ciContracts:false},
    docs:{unit:'docs',browser:'none',hydrate:false,dataset:false,bundles:false,ciContracts:false},
  };
  const selected={...table[plan]};if(ciContracts!==undefined)selected.ciContracts=ciContracts;
  return {plan,paths,reason,publication,browserGroups,...selected};
}

export function writeGithubOutputs(classification,file=process.env.GITHUB_OUTPUT) {
  if(!file)throw new Error('GITHUB_OUTPUT is required for --github-output.');
  const lines={plan:classification.plan,unit_plan:classification.unit,browser_plan:classification.browser,
    hydrate_replays:String(classification.hydrate),dataset_audit:String(classification.dataset),build_bundles:String(classification.bundles),
    ci_contracts:String(classification.ciContracts),publication_kind:classification.publication?.kind||'',publication_slug:classification.publication?.slug||'',
    browser_groups:(classification.browserGroups||[]).join(','),reason:classification.reason||''};
  appendFileSync(file,Object.entries(lines).map(([key,value])=>`${key}=${value}\n`).join(''));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),githubOutput=args.includes('--github-output'),forceFull=args.includes('--full');
  const paths=args.filter(arg=>!['--github-output','--full'].includes(arg));
  const classification=classifyChanges(paths,{forceFull});
  if(githubOutput)writeGithubOutputs(classification);
  console.log(JSON.stringify(classification));
}
