import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GUIDE_IDS} from '../set-guides.mjs';

const ORIGIN='https://packone.pro';
const escapeHtml=value=>String(value).replaceAll('&','&amp;')
  .replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
  .replaceAll("'",'&#039;');

function parsedMetadata(html,path){
  const end=html.indexOf('</head>');
  assert.ok(end>0,`${path}: document head is present`);
  const head=html.slice(0,end);
  const matches=[...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length,1,`${path}: exactly one JSON-LD block in the head`);
  const data=JSON.parse(matches[0][1]);
  assert.equal(data['@context'],'https://schema.org');
  assert.ok(Array.isArray(data['@graph']));
  return {head,graph:data['@graph']};
}

test('homepage describes the free daily MTG game without changing the rendered shell',async()=>{
  const html=await readFile('index.html','utf8');
  const {head,graph}=parsedMetadata(html,'index.html');
  assert.match(head,/<title>Pack One: Free Daily MTG Draft Practice Game<\/title>/);
  assert.match(head,/<meta name="description" content="Free daily MTG draft practice:/);
  assert.match(head,/<link rel="canonical" href="https:\/\/packone\.pro\/" \/>/);
  assert.match(head,/<script async src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1217971050094766" crossorigin="anonymous"><\/script>/);
  assert.doesNotMatch(head,/<meta name="google-adsense-account"/);
  const site=graph.find(node=>node['@type']==='WebSite');
  const app=graph.find(node=>node['@type']==='WebApplication');
  assert.equal(site?.url,ORIGIN+'/');
  assert.equal(app?.url,ORIGIN+'/');
  assert.equal(app?.isPartOf?.['@id'],ORIGIN+'/#website');
  assert.equal(app?.applicationCategory,'GameApplication');
  assert.equal(app?.offers?.price,'0');
  // The SEO change must remain in the document head: gameplay and its UI
  // continue to be owned by the existing application scripts.
  const body=html.slice(html.indexOf('</head>')+'</head>'.length);
  assert.match(body,/<main id="app" class="app"><\/main>/);
  assert.match(body,/src="bootstrap\.mjs\?v=56"/);
  assert.doesNotMatch(body,/application\/ld\+json/);
});

test('all published set guides have accurate, consistent structured metadata',async()=>{
  const {names}=JSON.parse(await readFile('data/set-display-names.json','utf8'));
  const sitemap=await readFile('sitemap.xml','utf8');
  for(const id of GUIDE_IDS){
    const path=`sets/${id}/guide/index.html`;
    const html=await readFile(path,'utf8');
    const {head,graph}=parsedMetadata(html,path);
    const name=names[id];
    const url=`${ORIGIN}/sets/${id}/guide/`;
    const title=`${name} MTG Draft Guide | Pack One`;
    const description=`Explore ${name} MTG Limited archetypes, mechanics, and format reminders, with 17Lands color results where available.`;
    assert.ok(head.includes(`<title>${escapeHtml(title)}</title>`),`${path}: search title`);
    assert.ok(head.includes(`<meta name="description" content="${escapeHtml(description)}" />`),`${path}: search description`);
    assert.ok(head.includes(`<link rel="canonical" href="${url}" />`),`${path}: canonical`);
    assert.ok(sitemap.includes(`<loc>${url}</loc>`),`${path}: listed in sitemap`);

    const page=graph.find(node=>node['@type']==='WebPage');
    const crumbs=graph.find(node=>node['@type']==='BreadcrumbList');
    assert.equal(page?.url,url,`${path}: structured page URL`);
    assert.equal(page?.name,title,`${path}: structured page name`);
    assert.equal(page?.description,description,`${path}: structured page description`);
    assert.equal(page?.isPartOf?.['@id'],ORIGIN+'/#website');
    assert.equal(page?.breadcrumb?.['@id'],url+'#breadcrumb');
    assert.equal(crumbs?.['@id'],url+'#breadcrumb');
    assert.deepEqual(crumbs?.itemListElement?.map(item=>item.position),[1,2,3]);
    assert.equal(crumbs.itemListElement[0].item,ORIGIN+'/');
    assert.equal(crumbs.itemListElement[1].item,ORIGIN+'/sets/');
    assert.equal(crumbs.itemListElement[2].item,url);
    assert.equal(crumbs.itemListElement[2].name,`${name} draft guide`);
  }
});

test('member practice remains intentionally noindex and absent from the sitemap',async()=>{
  const practice=await readFile('practice/index.html','utf8');
  const sitemap=await readFile('sitemap.xml','utf8');
  assert.match(practice,/<meta name="robots" content="noindex,follow" \/>/);
  assert.doesNotMatch(sitemap,/https:\/\/packone\.pro\/practice\//);
});
