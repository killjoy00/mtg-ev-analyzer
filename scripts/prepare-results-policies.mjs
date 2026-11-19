// Prepare the final policy-only commit after the owner-approved backend launch.
// Without --apply, write review copies outside the live policy routes.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const copy=JSON.parse(fs.readFileSync(new URL('../docs/releases/results-policy-copy.json',import.meta.url)));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const paras=items=>items.map(p=>'<p>'+esc(p)+'</p>').join('\n');
function once(source,pattern,replacement){let count=0;const result=source.replace(pattern,(...args)=>{count++;return typeof replacement==='function'?replacement(...args):replacement;});if(count!==1)throw Error('Policy source changed; review required.');return result;}
function replaceParagraph(source,prefix,items){return once(source,new RegExp('<p>'+prefix+'[\\s\\S]*?</p>'),paras(items));}
function insertBefore(source,title,newTitle,items){return once(source,new RegExp('<h2(?: [^>]*)?>'+title+'</h2>'),'<h2>'+newTitle+'</h2>\n'+paras(items)+'\n$MARKER$').replace('$MARKER$',source.match(new RegExp('<h2(?: [^>]*)?>'+title+'</h2>'))[0]);}
function nativeParagraph(source,prefix,items){return once(source,new RegExp('^(\\s*)[\'\"]'+prefix+'.*$','m'),(_,indent)=>items.map(p=>indent+JSON.stringify(p)+',').join('\n'));}
function nativeBefore(source,title,newTitle,items){return once(source,new RegExp("  \\{\\n    title: '"+title+"',"),"  {\n    title: "+JSON.stringify(newTitle)+",\n    body: "+JSON.stringify(items,null,2)+",\n  },\n  {\n    title: '"+title+"',");}
export function prepareResultsPolicies(root='.',date='{{RELEASE_DATE}}'){
 if(date!=='{{RELEASE_DATE}}'&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date).toISOString().slice(0,10)!==date))throw Error('Real release date required.');
 let privacy=fs.readFileSync(path.join(root,'privacy/index.html'),'utf8');
 let terms=fs.readFileSync(path.join(root,'terms/index.html'),'utf8');
 let native=fs.readFileSync(path.join(root,'mobile/src/nativeEditorial.ts'),'utf8');
 const published=native.match(/^export const resultsPolicyReleaseDate = ("[^"\n]+");$/m);
 if(published){
  const previous=JSON.parse(published[1]);
  const restamp=source=>{
   const markers=source.match(/<p>Last updated: [^<]+<\/p>/g)||[];
   if(markers.length!==1||markers[0]!=='<p>Last updated: '+previous+'</p>')throw Error('Policy dates differ; review required.');
   return source.replace(markers[0],'<p>Last updated: '+date+'</p>');
  };
  const files={'privacy/index.html':restamp(privacy),'terms/index.html':restamp(terms),
   'mobile/src/nativeEditorial.ts':once(native,/^export const resultsPolicyReleaseDate = "[^"\n]+";$/gm,'export const resultsPolicyReleaseDate = '+JSON.stringify(date)+';')};
  for(const name of ['privacy','terms']){
   const file='mobile/app/'+name+'.tsx',screen=fs.readFileSync(path.join(root,file),'utf8');
   if(!screen.includes('Last updated: {resultsPolicyReleaseDate}'))throw Error('Native policy date is missing.');
   files[file]=screen;
  }
  return files;
 }
 privacy=once(privacy,/<h1>Privacy<\/h1>/,'<h1>Privacy</h1><p>Last updated: '+date+'</p>');
 privacy=replaceParagraph(privacy,'Email/password signup requires email verification\\.',copy.accounts);
 privacy=insertBefore(privacy,'Gameplay, analytics, and decision reports','Results and news emails',copy.emails);
 privacy=insertBefore(privacy,'Memberships and subscriptions','Public leaderboards and results',copy.public);
 privacy=replaceParagraph(privacy,'Deletion removes attributable Pack One data',copy.retention);
 privacy=replaceParagraph(privacy,'Deletion normally completes immediately',[]);
 privacy=privacy.replace('Resend for transactional account email delivery','Resend for account and optional emails');
 privacy=insertBefore(privacy,'Your choices and contact','Changes to this Privacy Policy',copy.privacyChanges);
 privacy=once(privacy,/You can play without an account,[\s\S]*?request account deletion\./,esc(copy.choices[0]));
 terms=once(terms,/<h1>Terms<\/h1>/,'<h1>Terms</h1><p>Last updated: '+date+'</p>');
 terms=replaceParagraph(terms,'Account-owned leaderboard names, public profiles',copy.identity);
 terms=insertBefore(terms,'Data and attribution','Communications',copy.communications);
 terms=once(terms,/<\/div>\s*<p class="article-return">/,'<h2>Changes to these Terms</h2>'+paras(copy.termsChanges)+'</div>\n<p class="article-return">');
 native=nativeParagraph(native,'Email/password signup requires email verification\\.',copy.accounts);
 native=nativeBefore(native,'Gameplay, analytics, and decision reports','Results and news emails',copy.emails);
 native=nativeBefore(native,'Memberships and subscriptions','Public leaderboards and results',copy.public);
 native=nativeParagraph(native,'Deletion removes attributable Pack One data',copy.retention);
 native=nativeParagraph(native,'Deletion normally completes immediately',[]);
 native=native.replace('Resend for transactional account email delivery','Resend for account and optional emails');
 native=nativeBefore(native,'Your choices and contact','Changes to this Privacy Policy',copy.privacyChanges);
 native=once(native,/You can play without an account,[\s\S]*?request account deletion\./,copy.choices[0]);
 native=nativeParagraph(native,'Account-owned leaderboard names, public profiles',copy.identity);
 native=nativeBefore(native,'Data and attribution','Communications',copy.communications);
 // Append the new Terms section before the next export (or end of file).
 const start=native.indexOf('export const termsSections');const end=native.indexOf('\n];',start);
 if(end<0)throw Error('Terms array missing.');
 native=native.slice(0,end)+'\n  {title: "Changes to these Terms", body: '+JSON.stringify(copy.termsChanges)+'},'+native.slice(end);
 native+='\nexport const resultsPolicyReleaseDate = '+JSON.stringify(date)+';\n';
 const files={'privacy/index.html':privacy,'terms/index.html':terms,'mobile/src/nativeEditorial.ts':native};
 for(const name of ['privacy','terms']){
  const file='mobile/app/'+name+'.tsx';let screen=fs.readFileSync(path.join(root,file),'utf8');
  screen=screen.replace('{ '+name+'Sections }','{ '+name+'Sections, resultsPolicyReleaseDate }');
  if(name==='privacy')screen="import { Text } from '@/src/components/Text';\n"+screen;
  screen=screen.replace('      sections={'+name+'Sections}','      intro={<Text>Last updated: {resultsPolicyReleaseDate}</Text>}\n      sections={'+name+'Sections}');files[file]=screen;
 }
 return files;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),apply=args.includes('--apply'),date=args.find(v=>/^\d{4}-\d{2}-\d{2}$/.test(v));
 if(apply){
  if(!date)throw Error('Choose the real release date before applying.');
  const response=await fetch('https://api.packone.pro/growth/v1/results/launch',{redirect:'error'});
  if(!response.ok)throw Error('Backend launch could not be verified.');
  const launch=await response.json();
  if(!launch.active||new Date(launch.launchAt).toLocaleDateString('en-CA',{timeZone:'America/Chicago'})!==date)throw Error('Verified active backend launch must match the release date.');
 }
 for(const [name,contents] of Object.entries(prepareResultsPolicies('.',date))){
  const target=apply?name:path.join('docs/releases/results-privacy-preview',name);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,contents.replace(/[ \t]+$/gm,''));
 }
 console.log(apply?'Prepared final policy-only changes; review and approval still required.':'Prepared unreleased policy review copies. Live routes unchanged.');
}
