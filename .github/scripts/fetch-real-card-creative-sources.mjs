import {mkdir,writeFile} from 'node:fs/promises';
const dir='real-card-art';await mkdir(dir,{recursive:true});
const cards=[['hero-in-training','Hero in Training',16],['web-up','Web Up',41],['the-vision','The Vision',255]];
const data=[];
for(const [slug,name,collectorNo] of cards){
 const url='https://api.scryfall.com/cards/msh/'+collectorNo;
 const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'PackOne-StoreCreativeReview/1.0 (packone.pro)'},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Cannot find real Magic card '+name+': '+r.status+' '+(await r.text()).slice(0,300));
 const c=await r.json();
 if(c.name!==name||c.set?.toUpperCase()!=='MSH')throw Error('Real card identity mismatch for '+name+': '+c.name+' '+c.set);
 const imageUrl=c.image_uris?.png||c.image_uris?.large;
 if(!imageUrl)throw Error('Card missing full card image: '+name);
 const ir=await fetch(imageUrl,{headers:{'User-Agent':'PackOne-StoreCreativeReview/1.0 (packone.pro)'},signal:AbortSignal.timeout(45000)});
 if(!ir.ok)throw Error('Card image download '+name+' HTTP '+ir.status);
 const bytes=new Uint8Array(await ir.arrayBuffer());
 const path=dir+'/'+slug+(c.image_uris?.png?'.png':'.jpg');
 await writeFile(path,bytes);
 data.push({name,set:c.set,collector_number:c.collector_number,scryfall_id:c.id,source_uri:c.scryfall_uri,filename:path,image_url:imageUrl,image_bytes:bytes.length});
 console.log('Verified '+name+' MSH card '+c.collector_number+' image bytes='+bytes.length);
}
await writeFile(dir+'/sources.json',JSON.stringify({purpose:'Real art from actual Pack One 2026-11-18 draft example; for editorial review and design comps only',cards:data},null,2)+'\n');
