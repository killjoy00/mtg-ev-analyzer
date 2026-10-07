// Preloaded with `node --import` by every e2e browser step (.github/workflows/e2e.yml).
// leaderboard-config.js used to send localhost straight to the production Neon
// Functions, so every request a test did not stub reached production: fixture
// tokens produced a steady stream of 401s on /v1/events and unstubbed guest
// session calls could create real players (#803). Localhost now uses the
// development branch, but this still blocks every Neon and production API host
// for every browser the tests launch, so tests stay hermetic. A test's own page
// and context routes still win.
// WebKit has no resolver override, so there only the context route applies.
import {chromium,firefox,webkit} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {CHROMIUM_RESOLVER_RULES,PRODUCTION_API_HOST} from './e2e-production-hosts.mjs';

async function blockProduction(context) {
  await context.route(url=>PRODUCTION_API_HOST.test(url.hostname),route=>{
    const request=route.request(),url=new URL(request.url());
    process.stderr.write(`[e2e-production-guard] blocked ${request.method()} ${url.hostname}${url.pathname}\n`);
    return route.abort('blockedbyclient');
  });
  return context;
}

const instrumented=new WeakSet(),flushed=new WeakSet();
let contextIndex=0;
async function instrument(context) {
  if(instrumented.has(context))return context;
  instrumented.add(context);
  const id=(process.env.PACK1_E2E_ARTIFACT_ID||path.basename(process.argv[1]||'browser')).replace(/[^a-zA-Z0-9_-]/g,'_');
  const root=path.join('artifacts/browser',id);fs.mkdirSync(root,{recursive:true});
  const index=contextIndex++,events=[];
  await context.tracing.start({screenshots:true,snapshots:true});
  context.on('page',page=>{
    page.on('pageerror',error=>events.push({kind:'pageerror',message:error.message}));
    page.on('console',message=>{if(message.type()==='error')events.push({kind:'console',message:message.text().slice(0,1000)});});
    page.on('requestfailed',request=>{
      const url=new URL(request.url());
      events.push({kind:'requestfailed',method:request.method(),host:url.hostname,path:url.pathname,error:request.failure()?.errorText});
    });
  });
  const flush=async()=>{
    if(flushed.has(context))return;
    flushed.add(context);
    for(const [n,page] of context.pages().entries()) {
      try {await page.screenshot({path:path.join(root,`context-${index}-page-${n}.png`),timeout:5000});}catch{}
    }
    try {await context.tracing.stop({path:path.join(root,`context-${index}-trace.zip`)});}catch{}
    fs.writeFileSync(path.join(root,`context-${index}-events.json`),JSON.stringify(events,null,2));
  };
  const close=context.close.bind(context);
  context.close=async(...args)=>{await flush();return close(...args);};
  context.__pack1Flush=flush;
  return context;
}

for(const type of [chromium,firefox,webkit]) {
  const launch=type.launch.bind(type);
  type.launch=async(options={})=>{
    const browser=await launch(type===chromium?{...options,args:[...(options.args||[]),CHROMIUM_RESOLVER_RULES]}:options);
    const newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser);
    browser.newContext=async(...args)=>instrument(await blockProduction(await newContext(...args)));
    browser.newPage=async(...args)=>{const page=await newPage(...args);await instrument(await blockProduction(page.context()));return page;};
    const close=browser.close.bind(browser);
    browser.close=async(...args)=>{for(const context of browser.contexts())await context.__pack1Flush?.();return close(...args);};
    return browser;
  };
}
process.stderr.write('[e2e-production-guard] production API blocked for this run\n');
