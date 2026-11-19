import { needsNativeScreenshots } from '../../mobile/scripts/screenshot-ci-scope.mjs';

// A single, always-reported status check may be required by the main ruleset.
// Never require the path-filtered workflow jobs directly: absent checks hang PRs.
const rootMobileInputs = new Set([
  'card-faces.mjs',
  'card-faces.d.mts',
  '.github/android-internal-release-request.json',
  '.github/android-production-bundle-request.json',
]);
const mobileWorkflowNames = new Set([
  'mobile.yml',
  'mobile-store-screenshots.yml',
  'android-internal-testing.yml',
  'android-production-bundle.yml',
  'ios-testflight.yml',
  'mobile-exact-main-rc.yml',
]);

export function isMobilePrInput(path) {
  return path.startsWith('mobile/') ||
    path.startsWith('.github/actions/mobile-validate/') ||
    rootMobileInputs.has(path) ||
    (path.startsWith('.github/workflows/') &&
      mobileWorkflowNames.has(path.slice('.github/workflows/'.length)));
}

const basic = [
  { path: '.github/workflows/test.yml', jobs: ['test'] },
  { path: '.github/workflows/e2e.yml', jobs: ['browser'] },
];
const native = [
  { path: '.github/workflows/mobile.yml', jobs: ['validate'] },
  { path: '.github/workflows/android-internal-testing.yml',
    jobs: ['validate Android upload signing config'] },
  { path: '.github/workflows/android-production-bundle.yml',
    jobs: ['validate production Android bundle build'] },
];
const screenshot = '.github/workflows/mobile-store-screenshots.yml';

export function requiredWorkflows(paths) {
  if (!Array.isArray(paths) || paths.length === 0 ||
    paths.some(path => typeof path !== 'string' || !path)) {
    throw new Error('Cannot identify complete PR change set; refusing to pass required gate.');
  }
  const required = basic.map(spec => ({...spec, jobs: [...spec.jobs]}));
  if (!paths.some(isMobilePrInput)) return required;
  required.push(...native.map(spec => ({...spec, jobs: [...spec.jobs]})));
  const capture = needsNativeScreenshots(paths) ||
    paths.some(path => isMobilePrInput(path) && !path.startsWith('mobile/'));
  required.push({
    path: screenshot,
    jobs: capture
      ? ['validate screenshot fixture build', 'capture iPhone and iPad', 'capture Android phone']
      : ['validate screenshot fixture build'],
  });
  return required;
}

export function matchingRun(runs, spec, headSha, prNumber) {
  const matches = runs.filter(run =>
    run.path === spec.path &&
    run.event === 'pull_request' &&
    run.head_sha === headSha &&
    Array.isArray(run.pull_requests) &&
    run.pull_requests.some(pr =>
      pr.number === prNumber && (!pr.head?.sha || pr.head.sha === headSha)
    )
  );
  // A failed older attempt must not mask a newer retry, or vice versa.
  matches.sort((a, b) => Number(b.id) - Number(a.id) ||
    Number(b.run_attempt || 1) - Number(a.run_attempt || 1));
  return matches[0] || null;
}

export function assessRequiredWorkflows(required, runs, jobCache, headSha, prNumber) {
  const pending = [], failed = [], passed = [];
  for (const spec of required) {
    const run = matchingRun(runs, spec, headSha, prNumber);
    if (!run) {
      pending.push(spec.path + ': no current-head PR run');
      continue;
    }
    if (run.status !== 'completed') {
      pending.push(spec.path + ': ' + run.status);
      continue;
    }
    if (run.conclusion !== 'success') {
      failed.push(spec.path + ': workflow conclusion ' + run.conclusion);
      continue;
    }
    const cacheKey = String(run.id) + ':' + String(run.run_attempt || 1);
    const jobs = jobCache.get(cacheKey);
    if (!jobs) {
      pending.push(spec.path + ': awaiting job-level evidence');
      continue;
    }
    let valid = true;
    for (const name of spec.jobs) {
      const job = jobs.find(item => item.name === name);
      if (!job || job.conclusion !== 'success' || job.status !== 'completed') {
        failed.push(spec.path + ': required job ' + name +
          ' is ' + (job ? String(job.conclusion || job.status) : 'absent'));
        valid = false;
      }
    }
    if (valid) passed.push(spec.path);
  }
  return {
    state: failed.length ? 'failure' : pending.length ? 'pending' : 'success',
    pending, failed, passed,
  };
}

export async function runGate({ github, context, core }) {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request?.number;
  const headSha = context.payload.pull_request?.head?.sha;
  if (!prNumber || !/^[a-f0-9]{40}$/.test(headSha || '')) {
    throw new Error('Missing pull-request number or exact head SHA.');
  }

  const changed = await github.paginate(github.rest.pulls.listFiles,
    { owner, repo, pull_number: prNumber, per_page: 100 });
  // GitHub exposes a maximum of 3,000 PR files: refuse incomplete scopes.
  if (changed.length >= 3000) throw new Error('PR changed-file listing may be truncated.');
  const required = requiredWorkflows(changed.map(file => file.filename));
  core.info('Required current-head evidence: ' +
    required.map(spec => spec.path + ' [' + spec.jobs.join(', ') + ']').join('; '));

  const jobCache = new Map();
  const deadline = Date.now() + 115 * 60 * 1000;
  let previousState = '';
  while (Date.now() < deadline) {
    const { data: live } = await github.rest.pulls.get(
      { owner, repo, pull_number: prNumber });
    if (live.state !== 'open' || live.head.sha !== headSha) {
      throw new Error('PR closed or head changed while gate was running.');
    }
    const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo,
      { owner, repo, head_sha: headSha, event: 'pull_request', per_page: 100 });

    for (const spec of required) {
      const run = matchingRun(runs, spec, headSha, prNumber);
      if (!run || run.status !== 'completed' || run.conclusion !== 'success') continue;
      const key = String(run.id) + ':' + String(run.run_attempt || 1);
      if (!jobCache.has(key)) {
        const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun,
          { owner, repo, run_id: run.id, filter: 'latest', per_page: 100 });
        jobCache.set(key, jobs);
      }
    }
    const result = assessRequiredWorkflows(required, runs, jobCache, headSha, prNumber);
    const stateText = JSON.stringify(result);
    if (stateText !== previousState) {
      core.info('PR gate ' + result.state + ': ' +
        [...result.passed.map(x => 'passed ' + x),
         ...result.pending.map(x => 'waiting ' + x),
         ...result.failed.map(x => 'FAILED ' + x)].join('; '));
      previousState = stateText;
    }
    if (result.state === 'failure') throw new Error(result.failed.join('; '));
    if (result.state === 'success') {
      const { data: last } = await github.rest.pulls.get(
        { owner, repo, pull_number: prNumber });
      if (last.state !== 'open' || last.head.sha !== headSha) {
        throw new Error('PR changed before the required gate could pass.');
      }
      core.summary.addHeading('Required PR gate: passed', 2)
        .addRaw('All selected workflows and every required native job completed successfully on PR #' +
          prNumber + ', head ' + headSha + '.').addEOL()
        .addList(required.map(spec => spec.path + ': ' + spec.jobs.join(', ')));
      await core.summary.write();
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  throw new Error('Required current-head PR evidence did not complete within 115 minutes.');
}
