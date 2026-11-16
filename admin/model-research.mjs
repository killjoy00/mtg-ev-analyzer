// Authorized Admin-only research UI. Blinded decisions are fetched without any
// player vote counts, model recommendations, trophy choice or hypothesis tags.
// Research annotations are local to this page until explicitly copied.
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=x=>Number(x||0).toLocaleString();
const percent=x=>Number.isFinite(Number(x))?(100*Number(x)).toFixed(1)+'%':'N/A';
const formatName=x=>x==='latest'?'Latest Set':x==='powered-cube'?'Powered Cube':'Mixed';

export function bindModelResearch(root,request,queryString) {
  const load=root.querySelector('#model-research-load');
  const reveal=root.querySelector('#model-research-reveal');
  const copy=root.querySelector('#model-research-copy');
  const output=root.querySelector('#model-research-detail');
  const status=root.querySelector('#model-research-status');
  if(!load||!reveal||!copy||!output||!status)return;
  let packet=null,key=null,index=0,busy=false;
  const annotations=new Map();
  const statement=view=>'/v1/admin/measurements/reviews?'+
    (queryString?queryString+'&':'')+'research='+encodeURIComponent(view);
  function record() {
    const item=packet?.cases?.[index];if(!item)return;
    const best=output.querySelector('input[name="model-research-best"]:checked')?.value||null;
    const defensible=[...output.querySelectorAll('input[data-defensible]:checked')].map(el=>el.value);
    if(best||defensible.length)annotations.set(item.review_id,{best,defensible});
    else annotations.delete(item.review_id);
    copy.disabled=annotations.size===0;
  }
  function viewCase() {
    const item=packet?.cases?.[index];
    if(!item){output.innerHTML='<p class="muted">No eligible review cases in this period.</p>';return;}
    const previous=annotations.get(item.review_id)||{best:null,defensible:[]};
    const answer=key?.cases?.find(c=>c.review_id===item.review_id);
    output.innerHTML=
      '<p class="subpage-help">Case '+esc(item.review_id)+' · '+esc(formatName(item.environment))+
      ' · '+esc(String(item.set_id).toUpperCase())+' P1P'+esc(item.pick_number)+
      ' · '+(index+1)+' of '+packet.cases.length+
      '. Choose what you think is best before revealing the comparison.</p>'+
      '<p><strong>Earlier picks:</strong> '+esc(item.prior_picks.map(c=>c.name).join(', ')||'None')+'</p>'+
      '<div class="decision-cards">'+item.candidates.map(card=>
        '<article><p><strong>'+esc(card.name)+'</strong></p>'+
        (card.image_url?'<img src="'+esc(card.image_url)+'" alt="'+esc(card.name)+'" loading="lazy" style="max-width:98px;height:auto">':'')+
        '<p class="muted">'+esc(card.mana_cost||'')+' · '+esc(card.type_line||'Unknown type')+'</p>'+
        '<label><input type="radio" name="model-research-best" value="'+esc(card.id)+'"'+
        (previous.best===card.id?' checked':'')+'> Best choice</label>'+
        '<label><input type="checkbox" data-defensible value="'+esc(card.id)+'"'+
        (previous.defensible.includes(card.id)?' checked':'')+'> Defensible</label></article>'
      ).join('')+'</div>'+
      (answer?
        '<div class="subpage-section"><h3>After review: comparison</h3><p>Players favored <strong>'+esc(answer.player_favorite.name)+
        '</strong> ('+percent(answer.player_favorite.share)+', '+fmt(answer.sample_size)+' first-time answers). '+
        'The model favored <strong>'+esc(answer.model_favorite.name)+'</strong>. '+
        'Player-favorite model probability: '+percent(answer.player_favorite.model_probability)+
        '. Historical trophy pick: '+esc(item.candidates.find(c=>c.id===answer.trophy_pick_id)?.name||'Unknown')+'.</p>'+
        '<p class="subpage-help">Review sample: '+esc(answer.selection_group||'unknown')+'. Research flags: '+esc(answer.tags.join(', ')||'None')+
        '. Flags identify questions for expert review, not grading mistakes.</p></div>'
        :'')+
      '<div class="actions"><button type="button" id="model-research-prev" class="secondary"'+(index===0?' disabled':'')+'>Previous</button>'+
      '<button type="button" id="model-research-next"'+(index+1>=packet.cases.length?' disabled':'')+'>Next case</button></div>';
    output.querySelectorAll('input').forEach(el=>el.addEventListener('change',record));
    output.querySelector('#model-research-prev').onclick=()=>{record();index--;viewCase();};
    output.querySelector('#model-research-next').onclick=()=>{record();index++;viewCase();};
  }
  async function loadPacket(view) {
    if(busy)return;
    busy=true;load.disabled=true;reveal.disabled=true;
    status.textContent=view==='blind'?'Loading blinded cases…':'Loading the diagnostic key…';
    try {
      const result=await request(statement(view));
      if(view==='blind'){packet=result;key=null;index=0;annotations.clear();copy.disabled=true;}
      else {
        if(!packet)throw Error('Open the blind case list first.');
        if(result.cases.length!==packet.cases.length||
          result.cases.some((c,i)=>c.review_id!==packet.cases[i].review_id))
          throw Error('The case sample changed; reopen the blind review before comparing.');
        key=result;
      }
      if(packet)viewCase();
      status.textContent=view==='blind'?
        'Loaded '+fmt(packet.review_cases)+' source-distinct cases from '+esc(packet.qualified_puzzles)+
        ' eligible puzzles. Cards are shown without the model, votes or trophy choice.':
        'The diagnostic key is visible. Existing annotations were kept on this page.';
    } catch(error) {
      status.textContent=error?.message||'Research cases unavailable.';
    } finally {busy=false;load.disabled=false;reveal.disabled=!packet;}
  }
  load.onclick=()=>void loadPacket('blind');
  reveal.onclick=()=>{record();void loadPacket('diagnosis');};
  copy.onclick=async()=>{
    record();if(!packet||!annotations.size)return;
    const result={corpus_version:packet.corpus_version,from:packet.window?.from,
      to:packet.window?.to,blinded:!key,reviewed:[...annotations].map(([review_id,notes])=>({review_id,...notes}))};
    try {
      await navigator.clipboard.writeText(JSON.stringify(result,null,2));
      status.textContent='Review choices copied. No player votes or account identifiers included.';
    } catch{status.textContent='Copy unavailable in this browser. Review choices remain on this page.';}
  };
}
