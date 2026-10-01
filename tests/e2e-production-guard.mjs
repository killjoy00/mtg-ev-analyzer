// Preloaded with `node --import` by every e2e browser step (.github/workflows/e2e.yml).
// On any host but packone.pro, leaderboard-config.js points the app straight at the
// production Neon Functions, so every request a test did not stub reached production:
// fixture tokens produced a steady stream of 401s on /v1/events and unstubbed guest
// session calls could create real players (#803). This blocks the production API for
// every browser the tests launch. A test's own page and context routes still win.
// WebKit has no resolver override, so there only the context route applies.
import {chromium,firefox,webkit} from 'playwright';
import {CHROMIUM_RESOLVER_RULES,PRODUCTION_API_HOST} from './e2e-production-hosts.mjs';

async function blockProduction(context) {
  await context.route(url=>PRODUCTION_API_HOST.test(url.hostname),route=>{
    const request=route.request(),url=new URL(request.url());
    process.stderr.write(`[e2e-production-guard] blocked ${request.method()} ${url.hostname}${url.pathname}\n`);
    return route.abort('blockedbyclient');
  });
  return context;
}

for(const type of [chromium,firefox,webkit]) {
  const launch=type.launch.bind(type);
  type.launch=async(options={})=>{
    const browser=await launch(type===chromium?{...options,args:[...(options.args||[]),CHROMIUM_RESOLVER_RULES]}:options);
    const newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser);
    browser.newContext=async(...args)=>blockProduction(await newContext(...args));
    browser.newPage=async(...args)=>{const page=await newPage(...args);await blockProduction(page.context());return page;};
    return browser;
  };
}
process.stderr.write('[e2e-production-guard] production API blocked for this run\n');
