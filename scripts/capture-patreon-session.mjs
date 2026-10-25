// One-time LOCAL login capture. Run on your own computer in a real browser.
// This file only writes to gitignored artifacts/. Never upload that JSON to CI.
import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';

const DEST='artifacts/patreon-auth-state.json';
async function main() {
 if(process.env.CI)throw Error('This capture command must run on your own computer.');
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:false});
 try {
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.goto('https://www.patreon.com/',{waitUntil:'domcontentloaded'});
  const rl=createInterface({input:stdin,output:stdout});
  try {
   await rl.question('Sign in to your Patreon creator account in the browser, then press Enter here. ');
  } finally {rl.close();}
  const state=await context.storageState();
  if(!state.cookies.some(c=>typeof c.domain==='string'&&
     /(^|\.)patreon\.com$/.test(c.domain)&&c.value))
   throw Error('No Patreon cookies found; login was not captured.');
  await mkdir('artifacts',{recursive:true});
  await writeFile(DEST,JSON.stringify(state),{mode:0o600});
  await chmod(DEST,0o600);
  console.log('Saved an untracked local session file: '+DEST);
  console.log('From your local repo directory, run:');
  console.log("base64 < "+DEST+
   " | tr -d '\\n' | gh secret set PACKONE_PATREON_STORAGE_STATE_B64 -R killjoy00/mtg-ev-analyzer");
  console.log('Then securely delete the local session file. Never send it in chat or commit it.');
 } finally {await browser.close();}
}
main().catch(()=>{console.error('Patreon creator login capture failed; no session was exported.');process.exitCode=1;});
