import { ACCOUNT_SIGNAL_KEY, hasAccountSession } from '/growth-api.mjs';

function link(href,label,key,current=false){
  const a=document.createElement('a');
  a.className='top-nav-button';
  a.href=href;
  a.textContent=label;
  a.dataset.nav=key;
  if(current)a.setAttribute('aria-current','page');
  return a;
}

function currentFor(key){
  const path=location.pathname;
  if(key==='how')return path==='/how-it-works/'||path==='/how-it-works';
  if(key==='learn')return path==='/learn/'||path.startsWith('/learn/');
  return false;
}

export function syncSiteNavigation({doc=document}={}){
  const nav=doc.querySelector('[data-site-nav]');
  if(!nav)return;
  const signed=hasAccountSession();
  const items=signed
    ? [
        link('/?game=draft-run&daily=1','Daily Run','daily'),
        link('/?game=draft-run','Practice','practice'),
        link('/?game=draft-run&board=daily','Leaders','leaders'),
        link('/learn/','Learn','learn',currentFor('learn')),
        link('/?account=1','My Pack One','account'),
      ]
    : [
        link('/?game=draft-run&daily=1','Daily Run','daily'),
        link('/how-it-works/','How To Play','how',currentFor('how')),
        link('/?account=1','Sign in','account'),
      ];
  nav.replaceChildren(...items);
}

syncSiteNavigation();
globalThis.addEventListener?.('packone-account-changed',()=>syncSiteNavigation());
globalThis.addEventListener?.('storage',event=>{
  if(event.key==='pack1-auth-session-v1'||event.key===ACCOUNT_SIGNAL_KEY||event.key===null)syncSiteNavigation();
});
