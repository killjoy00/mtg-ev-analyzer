// One-time, browser-only Patreon authorization for the owner of the Codespace.
// Ports MUST remain GitHub-authenticated/private. Never publish their URL.
// No Patreon credentials, cookies, state or screenshots enter CI logs or repo files.
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmodSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const REPO='killjoy00/mtg-ev-analyzer';
const SECRET='PACKONE_PATREON_STORAGE_STATE_B64';
const PORT=6081;
const VNC_PASSWORD_FILE='/tmp/packone-patreon-vnc-password';

export function filteredPatreonState(raw) {
 const suffix=/^(\.|[a-z0-9-]*\.)?patreon\.com$/i;
 if(!Array.isArray(raw?.cookies)||!Array.isArray(raw?.origins))
  throw Error('session-unavailable');
 const cookies=raw.cookies.filter(c=>typeof c?.domain==='string'&&
  suffix.test(c.domain)&&typeof c.value==='string'&&c.value);
 const origins=raw.origins.filter(o=>{
  try {
   const url=new URL(o.origin);
   return url.protocol==='https:'&&suffix.test(url.hostname);
  }catch{return false;}
 });
 if(!cookies.length)throw Error('sign-in-not-confirmed');
 const state={cookies,origins};
 const value=Buffer.from(JSON.stringify(state)).toString('base64');
 // GitHub Actions secret values cannot exceed 48 KB.
 if(value.length>=48000)throw Error('session-too-large');
 return value;
}

export function codespaceHosts(name) {
 if(!/^[a-z][a-z0-9-]{4,80}$/.test(String(name||'')))
  throw Error('codespace-name-unavailable');
 return {login:'https://'+name+'-6080.app.github.dev/vnc.html?autoconnect=true&resize=scale',
  setup:name+'-6081.app.github.dev'};
}

export async function installSessionSecret(value,{token=process.env.GITHUB_TOKEN,
 spawnImpl=spawn}={}) {
 // GitHub CLI encrypts the value using the repository's Actions public key.
 // Never put the value on the command line or print command output.
 return new Promise(resolve=>{
  const env={...process.env};
  if(token)env.GH_TOKEN=token;
  const child=spawnImpl('gh',['secret','set',SECRET,'--repo',REPO,'--app','actions'],
   {env,stdio:['pipe','ignore','ignore']});
  let finished=false;
  function done(ok){if(!finished){finished=true;resolve(ok);}}
  child.on('error',()=>done(false));
  child.on('exit',code=>done(code===0));
  child.stdin.on('error',()=>done(false));
  child.stdin.end(value+'\n');
 });
}

const headers={
 'content-type':'text/html; charset=utf-8',
 'cache-control':'no-store',
 'referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff',
 'x-frame-options':'DENY',
 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; "+
  "script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; "+
  "form-action 'none'; frame-ancestors 'none'",
};
function pageHtml(login,password) {
 return '<!doctype html><html lang="en"><meta charset="utf-8">'+
 '<meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<title>Connect Pack One to Patreon</title>'+
 '<style>*{box-sizing:border-box}body{background:#0d1828;color:#f1f6ff;font-family:system-ui,-apple-system,sans-serif;line-height:1.45;margin:0;padding:28px 14px}main{max-width:480px;margin:auto}h1{font-size:23px}h2{font-size:17px;margin-bottom:6px}.card{background:#172b43;border:1px solid #3b5368;border-radius:14px;padding:18px;margin:14px 0}button,.link{display:block;background:#88c9ff;color:#0b2238;text-decoration:none;text-align:center;border:0;border-radius:9px;padding:14px;font-size:16px;font-weight:700;width:100%;cursor:pointer}button:disabled{opacity:.5}.small{font-size:13px;color:#c1d0e0}code{font-size:16px;color:#c6e7ff}#status{white-space:pre-wrap}textarea{width:100%;height:74px}a{color:#9ed8ff}</style>'+
 '<main><h1>Connect Pack One to Patreon</h1>'+
 '<p>One-time setup on your phone. Your login remains inside your private GitHub cloud browser.</p>'+
 '<section class="card"><h2>1. Sign in to Patreon</h2>'+
 '<p>Tap Open, enter the browser password when prompted, and sign in to your Pack One <b>creator</b> account. Return to this tab afterward.</p>'+
 '<p class="small">Temporary remote-browser password: <code id="vncpass"></code></p>'+
 '<a class="link" id="open" target="_blank" rel="noopener noreferrer">Open Patreon browser</a></section>'+
 '<section class="card"><h2>2. Save the connection</h2>'+
 '<p>After signing in, tap below. The encrypted GitHub Actions secret will be created if your Codespace has permission.</p>'+
 '<button id="save">Save Patreon connection</button><p id="status" role="status" class="small"></p>'+
 '<div id="manual" hidden><p>GitHub could not save the secret automatically using this Codespace. You can still complete setup entirely on your phone:</p>'+
 '<button id="copy">Copy session securely</button><p class="small">This copied text is sensitive. Do not share it or paste it in chat.</p>'+
 '<a class="link" href="https://github.com/killjoy00/mtg-ev-analyzer/settings/secrets/actions/new" target="_blank" rel="noopener noreferrer">Open GitHub Actions secret form</a>'+
 '<p class="small">Name: <code>PACKONE_PATREON_STORAGE_STATE_B64</code>. Paste the copied text into Secret, then tap Add secret. Clear your clipboard afterward.</p>'+
 '<textarea id="fallback" hidden spellcheck="false" aria-label="Session value for manual copy"></textarea></div></section>'+
 '<section class="card"><h2>3. Finish</h2><p>After this PR is merged and a live publisher test is verified, turn on the Actions variable <code>PACKONE_PATREON_AUTOPUBLISH_ENABLED</code> in GitHub. Posts then run automatically each morning.</p>'+
 '<p class="small">Keep both Codespaces ports <b>Private</b>. After saving, <a href="https://github.com/codespaces" target="_blank" rel="noopener noreferrer">delete this temporary Codespace</a> to remove the signed-in cloud browser. Do not enable an unverified publisher.</p></section>'+
 '</main><script>'+
 'document.getElementById("open").href='+JSON.stringify(login)+';'+
 'document.getElementById("vncpass").textContent='+JSON.stringify(password)+';'+
 'const status=document.getElementById("status"),btn=document.getElementById("save");'+
 'async function request(path){let r=await fetch(path,{method:"POST",cache:"no-store",credentials:"same-origin"});if(!r.ok)throw Error("The private connection service was unavailable");return r.json();}'+
 'btn.onclick=async()=>{btn.disabled=true;status.textContent="Checking Patreon sign-in and securing the session…";try{let r=await request("/save");if(r.saved){status.textContent="Connection securely saved to GitHub Actions. No session data was displayed.";document.getElementById("manual").hidden=true;}else{status.textContent="GitHub needs one manual secret entry. Use the buttons below (no code).";document.getElementById("manual").hidden=false;}}catch(e){status.textContent="Connection was not saved. Check that you finished signing into Patreon, then try again.";btn.disabled=false;}};'+
 'document.getElementById("copy").onclick=async()=>{try{let r=await request("/copy");if(!r.value)throw Error("missing");try{await navigator.clipboard.writeText(r.value);status.textContent="Session copied. Open GitHub and paste into the secret form.";}catch{let box=document.getElementById("fallback");box.hidden=false;box.value=r.value;box.focus();box.select();status.textContent="Copy the selected text using your phone, then paste it into the GitHub secret form.";}}catch{status.textContent="Session copy unavailable. Return to Patreon and save again.";}};'+
 '</script></html>';
}
function startProcess(command,args) {
 const child=spawn(command,args,{stdio:'ignore',env:{...process.env,DISPLAY:':93'}});
 child.on('error',()=>{});
 return child;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function startMobilePatreonSetup({
 name=process.env.CODESPACE_NAME,codespaces=process.env.CODESPACES,
 chromiumImpl=null}={}) {
 if(codespaces!=='true')throw Error('cloud-browser-only');
 const hosts=codespaceHosts(name);
 const password=randomBytes(12).toString('base64url').slice(0,8);
 const passwd=spawnSync('x11vnc',['-storepasswd',password,VNC_PASSWORD_FILE],
  {stdio:'ignore'});
 if(passwd.status!==0)throw Error('vnc-password-setup-failed');
 chmodSync(VNC_PASSWORD_FILE,0o600);
 startProcess('Xvfb',[':93','-screen','0','1280x850x24','-nolisten','tcp']);
 await delay(1600);
 startProcess('fluxbox',['-display',':93']);
 startProcess('x11vnc',['-display',':93','-rfbauth',VNC_PASSWORD_FILE,
  '-localhost','-rfbport','5900','-forever','-shared','-quiet']);
 startProcess('websockify',['--web','/usr/share/novnc','6080','127.0.0.1:5900']);
 const {chromium}=chromiumImpl||await import('playwright');
 const browser=await chromium.launch({headless:false,env:{...process.env,DISPLAY:':93'},
  args:['--window-position=0,0','--window-size=1280,850']});
 const context=await browser.newContext({viewport:null});
 const tab=await context.newPage();
 await tab.goto('https://www.patreon.com/',{waitUntil:'domcontentloaded',
  timeout:30000}).catch(()=>{});
 let value=null,saved=false,busy=false;
 const server=createServer(async(req,res)=>{
  // Codespaces private ports require GitHub authentication. Reject requests
  // with an unexpected host or a cross-origin mutation even inside the port.
  const host=String(req.headers.host||'').toLowerCase();
  if(![hosts.setup,'localhost:6081','127.0.0.1:6081'].includes(host)){
   res.writeHead(403);res.end();return;
  }
  if(req.method==='POST') {
   const allowedOrigin=host===hosts.setup?'https://'+host:'http://'+host;
   if(req.headers.origin!==allowedOrigin){res.writeHead(403);res.end();return;}
  }
  res.setHeader('cache-control','no-store');
  res.setHeader('referrer-policy','no-referrer');
  if(req.method==='GET'&&req.url==='/'){
   res.writeHead(200,headers);res.end(pageHtml(hosts.login,password));return;
  }
  if(req.method==='POST'&&req.url==='/save'){
   if(busy){res.writeHead(409);res.end();return;}
   busy=true;
   try {
    const url=new URL(tab.url());
    if(url.protocol!=='https:'||!/(^|\.)patreon\.com$/.test(url.hostname))
     throw Error('patreon-page-not-open');
    value=filteredPatreonState(await context.storageState());
    if(!saved)saved=await installSessionSecret(value);
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({saved}));
   }catch{
    res.writeHead(422,{'content-type':'application/json'});
    res.end('{"error":"sign-in-incomplete"}');
   }finally{busy=false;}
   return;
  }
  if(req.method==='POST'&&req.url==='/copy'&&value&&!saved){
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
   res.end(JSON.stringify({value}));return;
  }
  res.writeHead(404);res.end();
 });
 server.listen(PORT,'0.0.0.0');
 process.once('SIGTERM',()=>{server.close();browser.close().catch(()=>{});});
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
 startMobilePatreonSetup().catch(()=>{
  // Credentials, VNC password, web page details and tokens must never enter logs.
  console.error('Patreon mobile setup could not start. Check the private Codespace configuration.');
  process.exitCode=1;
 });
}
