import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {articleArtwork,BRAND_MARK,BRAND_VERSION} from '../research/pack-one-lab/artwork.mjs';
import {renderLabPreview} from '../admin/lab.mjs';

test('exact official mark, branded SVG and true zero-based bar width',()=>{
  assert.equal(BRAND_MARK,readFileSync(new URL('../mobile/assets/images/brand-mark.svg',import.meta.url),'utf8').trim());
  const metrics=[{label:'P1P1 — Common spell',numerator:104,denominator:939,percent:11.1},{label:'P1P5 — Common spell',numerator:139,denominator:301,percent:46.2}];
  const art=articleArtwork({title:'A rare & a common',set:'Reality Fracture',mode:'quick-hit',metrics});
  assert.equal(art.version,BRAND_VERSION);
  assert.match(art.cover_svg,/A rare &amp; a common/);
  assert.match(art.cover_svg,/#1e4d7a/);
  assert.match(art.chart_alt,/11\.1% \(104 of 939\)/);
  assert.match(art.chart_svg,/width="98\.568"/);
  assert.throws(()=>articleArtwork({title:'Bad',set:'Test',mode:'quick-hit',metrics:[{label:'Bad',numerator:8,denominator:7,percent:110}]}),/lab-artwork-metrics/);
});
test('private preview renders safe ordered text and exact cover/chart images',()=>{
  const metrics=[{label:'P1P5 — Previously picked spell name',numerator:105,denominator:179,percent:58.7}];
  const artwork=articleArtwork({title:'Another copy?',set:'The Hobbit',mode:'draft-decision',metrics});
  const fake={createElement(tag){return {tag,children:[],append(...nodes){this.children.push(...nodes);}}}};
  const article={schema_version:2,title:'Another copy?',series:'Draft Theory',sets:['The Hobbit'],artwork,
    blocks:[{type:'paragraph',text:'A <literal> sentence.'},{type:'facts',text:'58.7%'},{type:'chart'},{type:'heading',text:'The decision'},{type:'note',text:'Method.'}],source:'17Lands'};
  const nodes=renderLabPreview(article,fake).children;
  assert.deepEqual(nodes.map(n=>n.tag),['img','h3','p','p','p','img','h4','p','p']);
  assert.equal(nodes[3].textContent,'A <literal> sentence.');
  assert.equal(decodeURIComponent(nodes[0].src.split(',')[1]),artwork.cover_svg);
  assert.equal(decodeURIComponent(nodes[5].src.split(',')[1]),artwork.chart_svg);
  assert.throws(()=>renderLabPreview({...article,artwork:{...artwork,cover_svg:'<script>'}},fake),/Invalid Lab artwork/);
});
