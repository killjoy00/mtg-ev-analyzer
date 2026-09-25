import {buildCampaignDraft,campaignDestinationLabel,SUPPORTED_CAMPAIGN_DESTINATIONS,validateCampaignEntries} from '../campaign-links.mjs';

const valueOf=(form,name)=>form.elements.namedItem(name)?.value??'';
const show=value=>value||'—';

function setError(form,name,message) {
  const input=form.elements.namedItem(name);
  const error=document.querySelector(`[data-error="${name}"]`);
  if(input)input.setAttribute('aria-invalid',message?'true':'false');
  if(error){error.textContent=message||'';error.hidden=!message;}
}

export async function renderCampaignLinks(root) {
  root.innerHTML=`<section class="campaign-link-builder">
    <h1>Campaign Links / Link Builder</h1>
    <p class="muted">Build a tracked campaign URL immediately, or add a slug when you also want a static vanity route.</p>
    <p class="note"><strong>Publishing step required.</strong> Building or copying this link does not publish the vanity URL. The entry must be committed to <code>campaign-links.json</code> and deployed through the normal site PR.</p>
    <form id="campaign-link-form" class="campaign-form" novalidate>
      <label>Slug (needed for vanity URL)<input name="slug" autocomplete="off" spellcheck="false" placeholder="reddit-launch"><small data-error="slug" class="error" hidden></small></label>
      <label>Source<input name="source" autocomplete="off" spellcheck="false" placeholder="reddit"><small data-error="source" class="error" hidden></small></label>
      <label>Campaign<input name="campaign" autocomplete="off" spellcheck="false" placeholder="launch-week"><small data-error="campaign" class="error" hidden></small></label>
      <label>Medium (optional)<input name="medium" autocomplete="off" spellcheck="false" placeholder="social"><small data-error="medium" class="error" hidden></small></label>
      <label>Destination<select name="destination">${SUPPORTED_CAMPAIGN_DESTINATIONS.map(value=>`<option value="${value}">${campaignDestinationLabel(value)} (${value})</option>`).join('')}</select><small data-error="destination" class="error" hidden></small></label>
    </form>
    <div class="campaign-normalized" aria-label="Canonical normalized values">
      <div><span>Canonical slug</span><output id="canonical-slug">—</output></div>
      <div><span>Canonical source</span><output id="canonical-source">—</output></div>
      <div><span>Canonical campaign</span><output id="canonical-campaign">—</output></div>
      <div><span>Canonical medium</span><output id="canonical-medium">—</output></div>
    </div>
    <p id="slug-warning" class="campaign-warning" role="status" hidden></p>
    <div class="campaign-output">
      <label>Tracked UTM URL<input id="tracked-url" readonly aria-label="Tracked UTM URL"></label>
      <button type="button" class="secondary" data-copy="tracked-url">Copy tracked URL</button>
      <label>Intended vanity URL<input id="vanity-url" readonly aria-label="Intended vanity URL"></label>
      <button type="button" class="secondary" data-copy="vanity-url">Copy vanity URL</button>
      <label>campaign-links.json entry<textarea id="campaign-json" readonly aria-label="campaign-links.json entry" rows="8"></textarea></label>
      <button type="button" class="secondary" data-copy="campaign-json">Copy JSON entry</button>
    </div>
    <p id="copy-status" role="status"></p>
    <h2>Existing campaign links</h2>
    <p id="existing-status" class="muted">Loading the checked-in campaign registry…</p>
    <ul id="existing-campaign-links" class="campaign-existing"></ul>
  </section>`;

  const form=root.querySelector('#campaign-link-form');
  const existingStatus=root.querySelector('#existing-status');
  const existingList=root.querySelector('#existing-campaign-links');
  const slugWarning=root.querySelector('#slug-warning');
  const tracked=root.querySelector('#tracked-url');
  const vanity=root.querySelector('#vanity-url');
  const json=root.querySelector('#campaign-json');
  const copyStatus=root.querySelector('#copy-status');
  let existing=new Map();

  function update() {
    const draft=buildCampaignDraft({
      slug:valueOf(form,'slug'),
      source:valueOf(form,'source'),
      campaign:valueOf(form,'campaign'),
      medium:valueOf(form,'medium'),
      destination:valueOf(form,'destination')
    });
    root.querySelector('#canonical-slug').textContent=show(draft.normalized.slug);
    root.querySelector('#canonical-source').textContent=show(draft.normalized.source);
    root.querySelector('#canonical-campaign').textContent=show(draft.normalized.campaign);
    root.querySelector('#canonical-medium').textContent=show(draft.normalized.medium);
    for(const name of ['slug','source','campaign','medium','destination'])setError(form,name,draft.errors[name]);
    const duplicate=Boolean(draft.normalized.slug&&existing.has(draft.normalized.slug));
    slugWarning.hidden=!duplicate;
    slugWarning.textContent=duplicate?`Slug "${draft.normalized.slug}" already exists in campaign-links.json; reusing it would be rejected.`:'';
    tracked.value=draft.trackedUrl;
    vanity.value=draft.vanityUrl;
    json.value=draft.entry?JSON.stringify(draft.entry,null,2):'';
    for(const button of root.querySelectorAll('[data-copy]')) {
      const target=button.dataset.copy;
      if(target==='tracked-url')button.disabled=!draft.trackedUrl;
      else if(target==='campaign-json')button.disabled=!draft.entry||duplicate;
      else if(target==='vanity-url')button.disabled=!draft.valid||!draft.vanityUrl;
    }
    copyStatus.textContent='';
  }

  form.addEventListener('input',update);
  form.addEventListener('change',update);
  for(const button of root.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{
    const target=root.querySelector('#'+button.dataset.copy);
    const value='value' in target?target.value:target.textContent;
    try{await navigator.clipboard.writeText(value);copyStatus.textContent='Copied.';}
    catch{copyStatus.textContent='Copy failed. Select the value and copy it manually.';}
  });
  update();

  try {
    const response=await fetch('/campaign-links.json',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const entries=validateCampaignEntries(await response.json());
    existing=new Map(entries.map(entry=>[entry.slug,entry]));
    existingStatus.textContent=entries.length?`${entries.length} published campaign link(s).`:'No published campaign links yet.';
    existingList.replaceChildren(...entries.map(entry=>{
      const item=document.createElement('li');
      item.textContent=`${entry.slug} → ${entry.destination} · source=${entry.source} · campaign=${entry.campaign}${entry.medium?` · medium=${entry.medium}`:''}`;
      return item;
    }));
  } catch {
    existingStatus.textContent='Existing campaign links could not be loaded. Form validation still works, but slug reuse cannot be checked here.';
  }
  update();
}
