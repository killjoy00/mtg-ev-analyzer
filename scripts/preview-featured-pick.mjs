// Offline-safe PR preview of an actual anonymized October 23 Latest Set decision.
// Contains only public card names/URLs and aggregated counts, no player records.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {selectFeaturedPick,featureCopies} from './featured-pick.mjs';
import {debateCopies} from './featured-debate.mjs';
import {featuredYoutubeMetadata} from './publish-featured-pick.mjs';
const url=(s)=>'https://cards.scryfall.io/normal/front/'+s;
const prior=[
 ['Sanctum Lurker','2/1/2185c08f-bb4d-49d5-8b6c-c629a48bb61c.jpg?1789556729'],
 ['Gideon the Oathless','c/9/c985b0d1-25bd-4069-aab7-a566ff27a8f6.jpg?1789127990'],
 ['Tetsuko Umezawa, Pursuer','d/f/df818900-ce5e-4b0d-a927-c975cbef7eda.jpg?1789128002'],
].map(([name,image])=>({name,image_url:url(image)}));
const candidates=[
 ['way-of-the-mind-sculptor','Way of the Mind Sculptor','5/8/5838af68-66c3-4fe8-ab89-0a1721b0cfeb.jpg?1789729565'],
 ['awaken-the-inferno','Awaken the Inferno','c/5/c596c4ec-8480-4be9-a45d-700398a126f6.jpg?1789556812'],
 ['twisted-fates','Twisted Fates','c/7/c7c0765d-38fd-4d7b-bfb4-49b10ff5939b.jpg?1789614785'],
 ['theoretical-necromancer','Theoretical Necromancer','e/3/e36a7908-1e22-494b-adb4-e72ac0974d62.jpg?1789556734'],
 ['way-of-the-paradox','Way of the Paradox','9/8/98dc5470-507a-4364-8480-42607255e56c.jpg?1789729606'],
].map(([id,name,image])=>({id,name,image_url:url(image),model_probability:0.2}));
// Exactly what would be posted, for owner review before the format goes live.
export function debatePreview(feature) {
 const d=debateCopies(feature),yt=featuredYoutubeMetadata(feature).snippet;
 const block=t=>'```text\n'+t+'\n```';
 return ['### Bluesky question (morning, image: debate-question.jpg)',block(d.question),
  '**Image alt text:** '+d.questionAlt,'','### Bluesky reveal (reply, at least 4 hours later)',block(d.reveal),
  '### YouTube Short (featured-short.mp4)','**Title:** '+yt.title,block(yt.description),''].join('\n');
}
export async function previewFeatured() {
 const day='2026-10-23';
 const rows=[{environment:'latest',round:4,pick_number:4,set_id:'fra',
  puzzle_id:'4e293f7aa757ba942e12a0db2808cfd8',
  payload:{historical_pick_id:'twisted-fates',candidates,prior_picks:prior},
  votes:{'way-of-the-mind-sculptor':57,'awaken-the-inferno':46,
   'twisted-fates':21,'theoretical-necromancer':9,'way-of-the-paradox':2}}];
 const feature=selectFeaturedPick(rows,{day}),copy=featureCopies(feature);
 if(feature?.environment!=='latest'||feature.tier!==3||feature.players!==135)
  throw Error('Featured preview fixture did not produce the expected Latest Set decision.');
 await mkdir('artifacts/featured-pick',{recursive:true});
 await writeFile('artifacts/featured-pick/pick.json',JSON.stringify({feature,copy},null,2)+'\n');
 await writeFile('artifacts/featured-pick/patreon.md',copy.patreon+'\n');
 await writeFile('artifacts/featured-pick/debate-preview.md',debatePreview(feature));
 return {preview:true,day,environment:feature.environment,tier:feature.tier,players:feature.players};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 previewFeatured().then(r=>console.log(JSON.stringify(r)))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
