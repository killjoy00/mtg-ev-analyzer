import test from 'node:test';
import assert from 'node:assert/strict';
import {articleArtwork} from '../research/pack-one-lab/artwork.mjs';
import {captureLabEditorial} from '../scripts/pack-one-lab-render.mjs';
test('real bundled Chromium captures approved cover and both charts as one JPEG',async()=>{
 const a=articleArtwork({title:'How many copies are too many?',set:'Fixture Set',mode:'quick-hit',metrics:[{label:'One copy',numerator:60,denominator:100,percent:60},{label:'Two copies',numerator:65,denominator:100,percent:65}]});
 const image=await captureLabEditorial({...a,outcome_chart_svg:a.chart_svg,outcome_chart_alt:a.chart_alt},{jpeg:true});
 assert.equal(image.width,960);assert.ok(image.height>1500);assert.ok(image.jpeg.length>5000);
});
