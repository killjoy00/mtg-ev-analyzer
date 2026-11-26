// The existing bridge accepts a single JPEG and native text. Combine only
// the exact reviewed cover and charts; keep the body native and selectable.
import {captureWeeklyRecap} from './pack-one-weekly-render.mjs';
const uri=(svg,css)=>{
 const fonts=[...css.matchAll(/@font-face\{[^}]+\}/g)].map(m=>m[0]).join('');
 const withFonts=svg.replace(/^<svg[^>]+>/,m=>m+'<style>'+fonts+'</style>');
 return 'data:image/svg+xml;base64,'+Buffer.from(withFonts).toString('base64');
};
export function labEditorialHtml(artwork,brand){
 const images=[artwork.cover_svg,artwork.chart_svg,...(artwork.outcome_chart_svg?[artwork.outcome_chart_svg]:[])];
 const markup=images.map(svg=>'<img src="'+uri(svg,brand.css)+'" alt="">').join('');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+brand.css+'\nhtml,body{margin:0!important;padding:0!important;background:#f7f8fa!important;font-family:"Source Sans 3",sans-serif!important}.weekly-article{width:100%;max-width:480px;margin:auto;padding:0;box-sizing:border-box}.weekly-article img{display:block;width:100%;height:auto;max-width:100%;margin:0 0 4px}</style></head><body><main class="weekly-article">'+markup+'</main></body></html>';
}
export const captureLabEditorial=(artwork,options={})=>captureWeeklyRecap(artwork,{...options,renderHtml:labEditorialHtml});
