// Public canonical card rules from the existing pinned context audit.
// Exact names only; no invented text, new HTTP requests, or complex-face guesses.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const PINS=Object.freeze({"fra":"5dee48cee16adf09b5c1003c4ef9af88a4951e4c24e7f7ba47283e444b80dfd7","hob":"4594f305a0a39c2c67e4279950e896e9c0b50a5c580b076b41ee2fffdc40ceb9","msh":"8707cdc91c4acba306aac4d30b619a97392ad0de0f3f432b6ed3f265bcb1e495","sos":"0c5b919b7a8e085bef1187b77044126f9cb43fb294f53c9cc8f6ada59833950b","tmt":"e29a47ebe43a7ca00135ae1721d300f7cb5d761b9bb534c75a6ab7f88391e3ed"});
const safe=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n&&!/[\u0000-\u0008\u000b-\u001f<>]/.test(s)&&!/https?:\/\//i.test(s);
export async function readRulesContext(meta){
  const pin=PINS[meta.set_id];
  if(!pin)return null;
  const bytes=await readFile(new URL('../../research/data/'+meta.set_id+'-rules-context-2026-10-29.json.gz',import.meta.url));
  if(bytes.length>1024*1024||createHash('sha256').update(bytes).digest('hex')!==pin)throw Error('lab-rules-hash');
  const table=JSON.parse(gunzipSync(bytes,{maxOutputLength:4*1024*1024}).toString('utf8'));
  if(!table||typeof table!=='object'||Array.isArray(table)||Object.keys(table).length>3000)throw Error('lab-rules-shape');
  const cards=Object.fromEntries(Object.entries(table).filter(([name,c])=>safe(name,160)&&c?.name===name&&!c.card_faces?.length&&safe(c.oracle_text,1800)&&safe(c.type_line,160)).map(([name,c])=>[name,{oracle_text:c.oracle_text,type_line:c.type_line}]));
  return {set_id:meta.set_id,sha256:pin,cards};
}
export function attachRulesContext(packet,meta,context){
  if(!context)return packet;
  if(context.set_id!==meta.set_id||context.sha256!==PINS[meta.set_id]||!context.cards||typeof context.cards!=='object'||Array.isArray(context.cards))throw Error('lab-rules-context');
  const names=[...new Set([...packet.research_context.cards.map(c=>c.name),...(packet.research_context.rare_examples||[]).map(c=>c.rare),...(packet.research_context.near_unanimous_exceptions||[]).flatMap(c=>c.alternatives.map(a=>a.name))])].slice(0,6);
  const cards=names.filter(name=>Object.hasOwn(context.cards,name)).map(name=>{
    const c=context.cards[name];if(!safe(c.oracle_text,1800)||!safe(c.type_line,160))throw Error('lab-rules-card');
    return {name,oracle_text:c.oracle_text,type_line:c.type_line};
  });
  if(!cards.length)return packet;
  return {...packet,research_context:{...packet.research_context,rules_context:{source:'Scryfall canonical card rules, pinned October 29, 2026',cards}},provenance:{...packet.provenance,hashes:{...packet.provenance.hashes,rules_metadata:context.sha256}},
    reference:packet.reference+' Use the supplied exact card rules to explain a plausible interaction or drafting implication when relevant. Distinguish a rules interaction from an observed causal outcome; do not invent unsupported card text.'};
}
