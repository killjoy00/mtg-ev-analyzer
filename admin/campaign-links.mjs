import {buildCampaignDraft,buildCampaignTrackingUrl,SUPPORTED_CAMPAIGN_DESTINATIONS,validateCampaignEntries,normalizeCampaignSlug} from '../campaign-links.mjs';

const valueOf=(form,name)=>form.elements.namedItem(name)?.value??'';
const show=value=>value||'—';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const creatorDefaults=()=>({source:'creator',campaign:'beat-the-creator',medium:'creator'});
const environmentLabel=value=>value==='latest'?'Latest Set':value==='powered-cube'?'Powered Cube':'Mixed';
const dateLabel=value=>value?new Date(value+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';

function setError(form,name,message) {
  const input=form.elements.namedItem(name);
  const error=document.querySelector(`[data-error="${name}"]`);
  if(input)input.setAttribute('aria-invalid',message?'true':'false');
  if(error){error.textContent=message||'';error.hidden=!message;}
}

async function copy(value,status) {
  try{await navigator.clipboard.writeText(value);status.textContent='Copied.';}
  catch{status.textContent='Copy failed. Select the value and copy it manually.';}
}

function creatorEntry(source,form) {
  const creatorName=String(valueOf(form,'creator_public_name')).trim();
  return {
    source_type:source?.source_type,
    ...(source?.source_type==='practice'?{share:source.share_id}:{creator_player_id:source?.creator_player_id,source_session_id:source?.source_session_id}),
    creator_public_name:creatorName,
    creator_handle:String(valueOf(form,'creator_handle')).trim()||null,
    slug:normalizeCampaignSlug(valueOf(form,'slug'))||String(valueOf(form,'slug')).trim().toLowerCase(),
    acquisition_source:String(valueOf(form,'source')).trim().toLowerCase(),
    acquisition_campaign:String(valueOf(form,'campaign')).trim().toLowerCase(),
    acquisition_medium:String(valueOf(form,'medium')).trim().toLowerCase(),
    headline:String(valueOf(form,'headline')).trim()||`Can you beat ${creatorName}?`,
    creator_post_run_note:String(valueOf(form,'creator_post_run_note')).trim()||null,
  };
}

function creatorTrackedUrl(challenge) {
  return buildCampaignTrackingUrl({
    destination:`/?game=draft-run&creator=${challenge.id}`,
    source:challenge.acquisition_source,
    campaign:challenge.acquisition_campaign,
    ...(challenge.acquisition_medium?{medium:challenge.acquisition_medium}:{}),
  },{allowCreator:true});
}

export function mergeCreatorChallengeState(listed,current) {
  return current?{...listed,...current}:listed;
}

export function creatorChallengesForDisplay(challenges,{showDeleted=false}={}) {
  const all=Array.isArray(challenges)?challenges:[];
  const deleted=all.filter(challenge=>challenge.status==='retired'&&challenge.publication_detail?.live_verified===true);
  return {
    deleted:deleted.length,
    visible:showDeleted?all:all.filter(challenge=>!(challenge.status==='retired'&&challenge.publication_detail?.live_verified===true)),
  };
}

export function creatorPublicationProgressText(expected='published',attempt=0) {
  const elapsed=Math.max(0,Number(attempt)||0)*6;
  const minutes=Math.floor(elapsed/60),seconds=elapsed%60;
  const elapsedLabel=elapsed?' ('+(minutes?minutes+'m ':'')+String(seconds).padStart(minutes?2:1,'0')+'s elapsed)':'';
  return expected==='retired'
    ? 'Deleting challenge safely… the unavailable page is still publishing'+elapsedLabel+'.'
    : 'Publishing protected vanity route… checks and Pages deployment are still running'+elapsedLabel+'.';
}
function creatorShareCopy(challenge) {
  const score=Number(challenge.source_score);
  const environment=environmentLabel(challenge.source_environment);
  const context=challenge.source_type==='daily'
    ? `the ${dateLabel(challenge.source_day)} Pack One ${environment} Daily`
    : `this Pack One ${environment} Practice run`;
  return `I scored ${score}/100 on ${context}. Think you can beat me? ${challenge.public_url||`https://packone.pro/creator/${challenge.slug}/`}`;
}


function creatorKitValues(challenge) {
  const publicUrl=`https://packone.pro/creator/${challenge.slug}/`;
  return {
    publicUrl,
    trackedUrl:creatorTrackedUrl(challenge),
    socialImage:publicUrl+'creator-card.png',
    copy:creatorShareCopy({...challenge,public_url:publicUrl}),
  };
}

async function downloadCreatorImage(challenge,status) {
  const {socialImage}=creatorKitValues(challenge);
  status.textContent='Downloading social image…';
  try {
    const response=await fetch(socialImage,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const blob=await response.blob();
    if(!String(blob.type||'').startsWith('image/'))throw new Error('Published social asset is not an image.');
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=`pack-one-${challenge.slug}-creator.png`;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),0);
    status.textContent='Social image downloaded.';
  } catch {
    status.textContent='Social image download failed. Retry after publication finishes.';
  }
}

function renderCreatorKit(target,challenge,status) {
  const {publicUrl,trackedUrl,socialImage,copy:postCopy}=creatorKitValues(challenge);
  target.hidden=false;
  target.innerHTML=`<h3>Creator kit</h3>
    <label>Public link<input readonly value="${esc(publicUrl)}"></label>
    <label>Tracked link<input readonly value="${esc(trackedUrl)}"></label>
    <label>Social image<input readonly value="${esc(socialImage)}"></label>
    <p data-creator-image-status class="muted">Loading published social image…</p>
    <img data-creator-kit-image src="${esc(socialImage)}" alt="${esc(challenge.headline||`Can you beat ${challenge.creator_public_name}?`)}" style="max-width:100%;height:auto">
    <label>Ready-to-send copy<textarea readonly rows="3">${esc(postCopy)}</textarea></label>
    <button type="button" class="secondary" data-copy-creator-link>Copy public link</button>
    <button type="button" class="secondary" data-copy-creator-tracked>Copy tracked link</button>
    <button type="button" class="secondary" data-copy-creator-image>Copy image URL</button>
    <button type="button" class="secondary" data-download-creator-image>Download social image</button>
    <button type="button" class="secondary" data-retry-creator-image hidden>Retry image preview</button>
    <button type="button" class="secondary" data-copy-creator-copy>Copy post copy</button>`;
  const image=target.querySelector('[data-creator-kit-image]');
  const imageStatus=target.querySelector('[data-creator-image-status]');
  const retry=target.querySelector('[data-retry-creator-image]');
  const reloadImage=()=>{
    retry.hidden=true;imageStatus.textContent='Loading published social image…';
    image.src=socialImage+(socialImage.includes('?')?'&':'?')+'v='+Date.now();
  };
  image.onload=()=>{imageStatus.textContent='Published social image ready.';retry.hidden=true;};
  image.onerror=()=>{imageStatus.textContent='Social image is not available yet.';retry.hidden=false;};
  retry.onclick=reloadImage;
  target.querySelector('[data-copy-creator-link]').onclick=()=>copy(publicUrl,status);
  target.querySelector('[data-copy-creator-tracked]').onclick=()=>copy(trackedUrl,status);
  target.querySelector('[data-copy-creator-image]').onclick=()=>copy(socialImage,status);
  target.querySelector('[data-download-creator-image]').onclick=()=>void downloadCreatorImage(challenge,status);
  target.querySelector('[data-copy-creator-copy]').onclick=()=>copy(postCopy,status);
}

export async function renderCampaignLinks(root,publishRequest,draftRequest) {
  root.innerHTML=`<section class="campaign-link-builder">
    <h1>Campaign Links / Creator Challenges</h1>
    <div class="campaign-mode-tabs" role="tablist" aria-label="Creation mode">
      <button type="button" class="secondary" data-mode="campaign" role="tab" aria-selected="true">Campaign Link</button>
      <button type="button" class="secondary" data-mode="creator" role="tab" aria-selected="false">Beat the Creator</button>
    </div>

    <section data-panel="campaign">
      <p class="muted">Build a tracked campaign URL immediately, or add a slug when you also want a static vanity route.</p>
      <p class="note"><strong>One-click publish.</strong> The tracked URL works immediately. For a vanity URL, Publish opens a protected site PR, runs the required checks, merges it, and waits for the Pages route to go live.</p>
      <form id="campaign-link-form" class="campaign-form" novalidate>
        <label>Slug (needed for vanity URL)<input name="slug" autocomplete="off" spellcheck="false" placeholder="reddit-launch"><small data-error="slug" class="error" hidden></small></label>
        <label>Source<input name="source" autocomplete="off" spellcheck="false" placeholder="reddit"><small data-error="source" class="error" hidden></small></label>
        <label>Campaign<input name="campaign" autocomplete="off" spellcheck="false" placeholder="launch-week"><small data-error="campaign" class="error" hidden></small></label>
        <label>Medium (optional)<input name="medium" autocomplete="off" spellcheck="false" placeholder="social"><small data-error="medium" class="error" hidden></small></label>
        <label>Destination<select name="destination">${SUPPORTED_CAMPAIGN_DESTINATIONS.map(value=>`<option value="${value}">Homepage (${value})</option>`).join('')}</select><small data-error="destination" class="error" hidden></small></label>
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
      <div class="campaign-publish-actions">
        <button type="button" id="publish-campaign">Publish vanity link</button>
        <p id="publish-status" role="status"></p>
      </div>
      <p id="copy-status" role="status"></p>
      <h2>Existing campaign links</h2>
      <p id="existing-status" class="muted">Loading the checked-in campaign registry…</p>
      <ul id="existing-campaign-links" class="campaign-existing"></ul>
    </section>

    <section data-panel="creator" hidden>
      <p class="muted">Promote one authentic completed Pack One run. The source session remains the gameplay authority; creator score, answers, and serving versions are never entered here.</p>
      <form id="creator-source-form" class="campaign-form">
        <fieldset class="creator-source-kind"><legend>Source run</legend>
          <label><input type="radio" name="source_type" value="practice" checked> Shared Practice Run</label>
          <label><input type="radio" name="source_type" value="daily"> Completed Daily</label>
        </fieldset>
        <div class="creator-source-input" data-creator-source="practice">
          <label>Pack One shared-run URL or ID<input name="share" autocomplete="off" spellcheck="false" placeholder="https://packone.pro/?game=draft-run&shared=…"></label>
          <button type="button" id="resolve-practice">Resolve source</button>
        </div>
        <div class="creator-source-input" data-creator-source="daily" hidden>
          <label>Find creator<input name="creator_search" autocomplete="off" placeholder="Display name"></label>
          <button type="button" id="find-creator">Find creator</button>
          <div id="creator-search-results"></div>
          <div id="creator-daily-results"></div>
        </div>
      </form>
      <p id="creator-source-status" role="status"></p>
      <section id="creator-source-preview" class="note" hidden></section>

      <form id="creator-meta-form" class="campaign-form" hidden novalidate>
        <label>Creator name<input name="creator_public_name" maxlength="80" required></label>
        <label>Creator handle (optional)<input name="creator_handle" maxlength="80" placeholder="@creator"></label>
        <label>Slug<input name="slug" autocomplete="off" spellcheck="false" placeholder="creator-reality-fracture" required></label>
        <label>Source<input name="source" value="creator" required></label>
        <label>Campaign<input name="campaign" value="beat-the-creator" required></label>
        <label>Medium<input name="medium" value="creator"></label>
        <label>Headline (optional)<input name="headline" maxlength="160" placeholder="Can you beat this creator?"></label>
        <label>Post-run creator note (optional)<textarea name="creator_post_run_note" maxlength="500" rows="3" placeholder="P3 was the one I really wasn’t sure about."></textarea></label>
      </form>
      <section id="creator-publish-preview" class="campaign-output" hidden></section>
      <div class="campaign-publish-actions">
        <button type="button" id="publish-creator" disabled>Publish creator challenge</button>
        <p id="creator-publish-status" role="status"></p>
      </div>
      <section id="creator-kit" class="note" hidden></section>

      <h2>Existing creator challenges</h2>
      <div class="campaign-publish-actions">
        <p id="creator-existing-status" class="muted">Loading creator challenges…</p>
        <button type="button" id="creator-show-deleted" class="secondary" hidden>Show deleted</button>
      </div>
      <div id="creator-existing"></div>
    </section>
  </section>`;

  const campaignPanel=root.querySelector('[data-panel="campaign"]'),creatorPanel=root.querySelector('[data-panel="creator"]');
  root.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    const creator=button.dataset.mode==='creator';
    campaignPanel.hidden=creator;creatorPanel.hidden=!creator;
    root.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-selected',String(item===button)));
  }));

  // Existing Campaign Link mode remains intentionally unchanged below.
  const form=root.querySelector('#campaign-link-form');
  const existingStatus=root.querySelector('#existing-status');
  const existingList=root.querySelector('#existing-campaign-links');
  const slugWarning=root.querySelector('#slug-warning');
  const tracked=root.querySelector('#tracked-url');
  const vanity=root.querySelector('#vanity-url');
  const json=root.querySelector('#campaign-json');
  const copyStatus=root.querySelector('#copy-status');
  const publishButton=root.querySelector('#publish-campaign');
  const publishStatus=root.querySelector('#publish-status');
  let existing=new Map(),publishing=false,publishConfigured=false;

  function currentDraft() {
    return buildCampaignDraft({
      slug:valueOf(form,'slug'),
      source:valueOf(form,'source'),
      campaign:valueOf(form,'campaign'),
      medium:valueOf(form,'medium'),
      destination:valueOf(form,'destination')
    });
  }

  function update() {
    const draft=currentDraft();
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
    for(const button of campaignPanel.querySelectorAll('[data-copy]')) {
      const target=button.dataset.copy;
      if(target==='tracked-url')button.disabled=!draft.trackedUrl;
      else if(target==='campaign-json')button.disabled=!draft.entry||duplicate;
      else if(target==='vanity-url')button.disabled=!draft.valid||!draft.vanityUrl;
    }
    publishButton.disabled=publishing||!publishConfigured||!draft.entry||duplicate;
    publishButton.textContent=publishing?'Publishing…':'Publish vanity link';
    copyStatus.textContent='';
  }

  function renderExisting(entries) {
    existing=new Map(entries.map(entry=>[entry.slug,entry]));
    existingStatus.textContent=entries.length?`${entries.length} published campaign link(s).`:'No published campaign links yet.';
    existingList.replaceChildren(...entries.map(entry=>{
      const item=document.createElement('li');
      item.textContent=`${entry.slug} → ${entry.destination} · source=${entry.source} · campaign=${entry.campaign}${entry.medium?` · medium=${entry.medium}`:''}`;
      return item;
    }));
  }

  async function loadExisting({quiet=false}={}) {
    try {
      const response=await fetch('/campaign-links.json',{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const entries=validateCampaignEntries(await response.json());
      renderExisting(entries);update();return true;
    } catch {
      if(!quiet)existingStatus.textContent='Existing campaign links could not be loaded. Form validation still works, but slug reuse cannot be checked here.';
      return false;
    }
  }

  async function loadPublishAvailability() {
    if(typeof publishRequest!=='function') {
      publishConfigured=false;publishStatus.textContent='Vanity publishing is not available in this Admin build.';update();return false;
    }
    try {
      const health=await publishRequest('/health?quick=1');
      publishConfigured=health?.campaign_link_publish_configured===true;
      if(!publishConfigured)publishStatus.textContent='Vanity publishing will become available after the production publisher is deployed.';
      update();return publishConfigured;
    } catch {
      publishConfigured=false;publishStatus.textContent='Vanity publishing status could not be verified. Try again after the production publisher is deployed.';update();return false;
    }
  }

  async function waitForPublished(slug,vanityUrl) {
    for(let attempt=0;attempt<100;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,6000));
      await loadExisting({quiet:true});
      if(existing.has(slug)) {publishStatus.classList.remove('error');publishStatus.textContent=`Published: ${vanityUrl}`;return true;}
    }
    publishStatus.classList.add('error');
    publishStatus.textContent='Publish was accepted, but the vanity route is not live yet. Check the campaign publishing workflow before distributing it.';
    return false;
  }

  form.addEventListener('input',update);form.addEventListener('change',update);
  for(const button of campaignPanel.querySelectorAll('[data-copy]'))button.addEventListener('click',()=>{
    const target=root.querySelector('#'+button.dataset.copy);return copy('value' in target?target.value:target.textContent,copyStatus);
  });
  publishButton.addEventListener('click',async()=>{
    const draft=currentDraft();if(publishing||!publishConfigured||!draft.entry||existing.has(draft.entry.slug))return;
    publishing=true;publishStatus.classList.remove('error');publishStatus.textContent='Starting protected publish…';update();
    try {
      const result=await publishRequest('/v1/admin/campaign-links/publish',draft.entry);
      publishStatus.textContent=`Publishing ${result.vanity_url}. Required checks and the Pages deploy are running automatically.`;
      await waitForPublished(draft.entry.slug,result.vanity_url);
    } catch(error) {publishStatus.classList.add('error');publishStatus.textContent=error.message||'Campaign publishing failed.';}
    finally {publishing=false;update();}
  });

  // Beat the Creator.
  const sourceForm=root.querySelector('#creator-source-form'),metaForm=root.querySelector('#creator-meta-form');
  const sourceStatus=root.querySelector('#creator-source-status'),sourcePreview=root.querySelector('#creator-source-preview');
  const creatorPreview=root.querySelector('#creator-publish-preview'),creatorPublish=root.querySelector('#publish-creator');
  const creatorPublishStatus=root.querySelector('#creator-publish-status'),creatorKit=root.querySelector('#creator-kit');
  const creatorExisting=root.querySelector('#creator-existing'),creatorExistingStatus=root.querySelector('#creator-existing-status');
  const creatorShowDeleted=root.querySelector('#creator-show-deleted');
  let creatorSource=null,creatorBusy=false,creatorDraft=null,creatorSlugs=new Set(),creatorShowDeletedRows=false;

  function setCreatorSource(next) {
    creatorSource=next;creatorDraft=null;
    sourcePreview.hidden=!next;metaForm.hidden=!next;creatorPreview.hidden=!next;
    if(!next){creatorPublish.disabled=true;return;}
    const type=next.source_type==='daily'?`Daily · ${dateLabel(next.day)}`:'Practice';
    sourcePreview.innerHTML=`<strong>${esc(next.creator_default_name)}</strong><br>${esc(environmentLabel(next.environment))} · ${next.decisions} decisions · Creator score <strong>${Number(next.score)}/100</strong><br>Source: ${esc(type)}<br><small>Authoritative session: ${esc(next.source_session_id)}${next.share_id?` · share ${esc(next.share_id)}`:''}</small>`;
    metaForm.elements.namedItem('creator_public_name').value=next.creator_default_name||'';
    if(!valueOf(metaForm,'headline'))metaForm.elements.namedItem('headline').value=`Can you beat ${next.creator_default_name}?`;
    renderCreatorPreview();
  }

  function renderCreatorPreview() {
    if(!creatorSource)return;
    const entry=creatorEntry(creatorSource,metaForm),slug=normalizeCampaignSlug(entry.slug);
    const duplicate=Boolean(slug&&(existing.has(slug)||creatorSlugs.has(slug)));
    creatorPublish.disabled=creatorBusy||!publishConfigured||!slug||!entry.creator_public_name||(duplicate&&!creatorDraft);
    const sourceContext=creatorSource.source_type==='daily'
      ? `${environmentLabel(creatorSource.environment)} Daily · ${dateLabel(creatorSource.day)}`
      : environmentLabel(creatorSource.environment);
    creatorPreview.innerHTML=`<p class="eyebrow">BEAT THE CREATOR</p><h2>${esc(entry.headline)}</h2><p>${esc(sourceContext)} · 8 decisions<br>Creator score: <strong>${Number(creatorSource.score)}/100</strong></p><p>Public URL: <code>https://packone.pro/creator/${esc(slug||'your-slug')}/</code><br>Attribution: source=${esc(entry.acquisition_source)} · campaign=${esc(entry.acquisition_campaign)}${entry.acquisition_medium?` · medium=${esc(entry.acquisition_medium)}`:''}</p>${duplicate&&!creatorDraft?'<p class="error">That slug is already reserved.</p>':''}`;
  }

  sourceForm.addEventListener('change',event=>{
    if(event.target?.name!=='source_type')return;
    const type=valueOf(sourceForm,'source_type');
    sourceForm.querySelector('[data-creator-source="practice"]').hidden=type!=='practice';
    sourceForm.querySelector('[data-creator-source="daily"]').hidden=type!=='daily';
    sourceStatus.textContent='';setCreatorSource(null);
  });
  metaForm.addEventListener('input',renderCreatorPreview);

  root.querySelector('#resolve-practice').addEventListener('click',async()=>{
    sourceStatus.textContent='Resolving authoritative shared run…';
    try {
      const result=await draftRequest('/v1/admin/creator-challenges/resolve',{source_type:'practice',share:valueOf(sourceForm,'share')});
      setCreatorSource(result.source);sourceStatus.textContent='Source resolved.';
    } catch(error){setCreatorSource(null);sourceStatus.textContent=error.message||'Source could not be resolved.';}
  });

  root.querySelector('#find-creator').addEventListener('click',async()=>{
    const target=root.querySelector('#creator-search-results'),dailyTarget=root.querySelector('#creator-daily-results');
    target.textContent='Searching…';dailyTarget.replaceChildren();setCreatorSource(null);
    try {
      const result=await draftRequest('/v1/admin/creator-challenges/players?search='+encodeURIComponent(valueOf(sourceForm,'creator_search')));
      target.replaceChildren(...result.players.map(player=>{
        const button=document.createElement('button');button.type='button';button.className='secondary';
        button.textContent=player.display_name+(player.linked_account?' · account':'');
        button.onclick=async()=>{
          dailyTarget.textContent='Loading recent completed Dailies…';
          try {
            const data=await draftRequest(`/v1/admin/creator-challenges/players/${player.player_id}/dailies`);
            if(!data.dailies.length){dailyTarget.textContent='No eligible completed Dailies found.';return;}
            dailyTarget.replaceChildren(...data.dailies.map(run=>{
              const use=document.createElement('button');use.type='button';use.className='secondary';
              use.textContent=`${dateLabel(run.day)} · ${environmentLabel(run.environment)} · ${Number(run.score)}/100 — Use this run`;
              use.onclick=async()=>{
                sourceStatus.textContent='Resolving authoritative Daily…';
                try {
                  const resolved=await draftRequest('/v1/admin/creator-challenges/resolve',{source_type:'daily',creator_player_id:player.player_id,source_session_id:run.session_id});
                  setCreatorSource(resolved.source);sourceStatus.textContent='Source resolved.';
                }catch(error){setCreatorSource(null);sourceStatus.textContent=error.message||'Daily could not be resolved.';}
              };
              return use;
            }));
          }catch(error){dailyTarget.textContent=error.message||'Dailies could not be loaded.';}
        };
        return button;
      }));
      if(!result.players.length)target.textContent='No matching public creator identity found.';
    }catch(error){target.textContent=error.message||'Creator search failed.';}
  });

  async function waitForCreatorPublication(challenge,expected='published',statusTarget=null) {
    for(let attempt=0;attempt<100;attempt++) {
      const status=await publishRequest(`/v1/admin/creator-challenges/${challenge.id}/publication`);
      if(expected==='published'&&status.state==='published'&&status.live_verified!==false)return status.challenge;
      if(expected==='retired'&&status.state==='retired'&&status.live_verified===true)return status.challenge;
      if(status.state==='failed')throw new Error(status.challenge?.publication_error||'Creator challenge publication failed.');
      if(statusTarget)statusTarget.textContent=creatorPublicationProgressText(expected,attempt);
      await new Promise(resolve=>setTimeout(resolve,6000));
    }
    throw new Error('Publication is still running. Reload Admin to reconcile the existing operation before distributing the URL.');
  }

  creatorPublish.addEventListener('click',async()=>{
    if(!creatorSource||creatorBusy||!publishConfigured)return;
    creatorBusy=true;creatorPublishStatus.classList.remove('error');creatorPublishStatus.textContent=creatorDraft?'Resuming protected publication…':'Creating immutable challenge draft…';renderCreatorPreview();
    try {
      if(!creatorDraft) {
        const created=await draftRequest('/v1/admin/creator-challenges',creatorEntry(creatorSource,metaForm));
        creatorDraft=created.challenge;
      }
      const challenge=creatorDraft;
      creatorPublishStatus.textContent='Starting protected vanity publication…';
      const requested=await publishRequest(`/v1/admin/creator-challenges/${challenge.id}/publication`,{action:'publish'});
      const published=requested.already_published?requested.challenge:await waitForCreatorPublication(challenge,'published',creatorPublishStatus);
      const publicUrl=`https://packone.pro/creator/${published.slug}/`;
      creatorPublishStatus.textContent=`Published: ${publicUrl}`;
      renderCreatorKit(creatorKit,published,creatorPublishStatus);
      await loadCreatorChallenges();
    } catch(error) {
      creatorPublishStatus.classList.add('error');creatorPublishStatus.textContent=error.message||'Creator challenge publication failed.';
    } finally {creatorBusy=false;renderCreatorPreview();}
  });

  async function loadCreatorChallenges() {
    try {
      const data=await draftRequest('/v1/admin/creator-challenges?limit=100');
      data.challenges=await Promise.all(data.challenges.map(async challenge=>{
        const pending=challenge.status==='publishing'
          ||(challenge.status==='retired'&&challenge.publication_operation_ref&&challenge.publication_detail?.live_verified!==true);
        if(!pending)return challenge;
        try {
          const current=await publishRequest(`/v1/admin/creator-challenges/${challenge.id}/publication`);
          return mergeCreatorChallengeState(challenge,current.challenge);
        } catch {
          return challenge;
        }
      }));
      creatorSlugs=new Set(data.challenges.map(challenge=>challenge.slug));
      const display=creatorChallengesForDisplay(data.challenges,{showDeleted:creatorShowDeletedRows});
      creatorShowDeleted.hidden=display.deleted===0;
      creatorShowDeleted.textContent=creatorShowDeletedRows?`Hide deleted (${display.deleted})`:`Show deleted (${display.deleted})`;
      creatorExistingStatus.textContent=display.visible.length
        ? `${display.visible.length} creator challenge(s).${!creatorShowDeletedRows&&display.deleted?` ${display.deleted} deleted hidden.`:''}`
        : display.deleted?'No active creator challenges. '+display.deleted+' deleted hidden.':'No creator challenges yet.';
      creatorExisting.replaceChildren(...display.visible.map(challenge=>{
        const item=document.createElement('article');item.className='note';
        const publicUrl=`https://packone.pro/creator/${challenge.slug}/`,trackedUrl=creatorTrackedUrl(challenge);
        const retiredVerified=challenge.status==='retired'&&challenge.publication_detail?.live_verified===true;
        item.innerHTML=`<strong>${esc(challenge.creator_public_name)}</strong> · ${esc(challenge.slug)}<br>${esc(challenge.source_type==='daily'?`Daily · ${dateLabel(challenge.source_day)}`:'Practice')} · ${esc(environmentLabel(challenge.source_environment))} · ${Number(challenge.source_score)}/100<br>Status: <strong>${esc(challenge.status)}</strong>${challenge.status==='retired'&&!retiredVerified?' · retired page not yet verified':''} · Opens: ${Number(challenge.opens||0)} · Starts: ${Number(challenge.starts||0)} · Completions: ${Number(challenge.completions||challenge.attempts||0)}<br>Attempts: ${Number(challenge.attempts||0)} · Beat rate: ${challenge.beat_percentage==null?'—':Number(challenge.beat_percentage)+'%'} · Avg challenger: ${challenge.average_score==null?'—':Number(challenge.average_score)+'/100'} · W/T/L: ${Number(challenge.wins||0)}/${Number(challenge.ties||0)}/${Number(challenge.losses||0)}<br><small>${esc(publicUrl)} · created ${esc(dateLabel(String(challenge.created_at||'').slice(0,10)))}${challenge.published_at?` · published ${esc(dateLabel(String(challenge.published_at).slice(0,10))) }`:''}</small><div class="actions">${['draft','failed','publishing'].includes(challenge.status)?'<button type="button" class="secondary" data-resume-publish>Publish / resume</button>':''}${challenge.status==='retired'&&!retiredVerified?'<button type="button" class="secondary" data-resume-retire>Finish delete</button>':''}<button type="button" class="secondary" data-copy-public>Copy public URL</button><button type="button" class="secondary" data-copy-tracked>Copy tracked URL</button>${challenge.status==='published'?'<button type="button" class="secondary" data-show-kit>Creator kit</button><a class="button secondary" target="_blank" rel="noopener" href="'+esc(publicUrl)+'">Open challenge</a>':''}${challenge.status!=='retired'?'<button type="button" class="secondary" data-retire>Delete</button>':''}</div><section class="note" data-existing-creator-kit hidden></section>`;
        item.querySelector('[data-copy-public]').onclick=()=>copy(publicUrl,creatorExistingStatus);
        item.querySelector('[data-copy-tracked]').onclick=()=>copy(trackedUrl,creatorExistingStatus);
        item.querySelector('[data-show-kit]')?.addEventListener('click',()=>{
          const kit=item.querySelector('[data-existing-creator-kit]');
          if(!kit.hidden){kit.hidden=true;return;}
          renderCreatorKit(kit,challenge,creatorExistingStatus);
        });
        item.querySelector('[data-resume-publish]')?.addEventListener('click',async()=>{
          creatorExistingStatus.textContent='Reconciling publication…';
          try {
            const current=await publishRequest(`/v1/admin/creator-challenges/${challenge.id}/publication`);
            if(current.state!=='publishing')await publishRequest(`/v1/admin/creator-challenges/${challenge.id}/publication`,{action:'publish'});
            await waitForCreatorPublication(challenge,'published',creatorExistingStatus);
            creatorExistingStatus.textContent='Creator challenge published.';
            await loadCreatorChallenges();
          } catch(error){creatorExistingStatus.textContent=error.message||'Could not publish challenge.';}
        });
        item.querySelector('[data-resume-retire]')?.addEventListener('click',async()=>{
          creatorExistingStatus.textContent='Finishing delete…';
          try {
            await publishRequest(`/v1/admin/creator-challenges/${challenge.id}/publication`,{action:'retire'});
            await waitForCreatorPublication(challenge,'retired',creatorExistingStatus);
            creatorExistingStatus.textContent='Delete finished.';
            await loadCreatorChallenges();
          } catch(error){creatorExistingStatus.textContent=error.message||'Could not finish deleting challenge.';}
        });
        item.querySelector('[data-retire]')?.addEventListener('click',async()=>{
          if(!confirm(`Delete ${challenge.creator_public_name} / ${challenge.slug}? New challenge attempts will stop and any published URL will show an unavailable page.`))return;
          try {
            await publishRequest(`/v1/admin/creator-challenges/${challenge.id}/publication`,{action:'retire'});
            creatorExistingStatus.textContent='Deleting challenge. Publishing its unavailable page…';
            await waitForCreatorPublication(challenge,'retired',creatorExistingStatus);
            await loadCreatorChallenges();
          } catch(error){creatorExistingStatus.textContent=error.message||'Could not delete challenge.';}
        });
        return item;
      }));
    }catch(error){creatorExistingStatus.textContent=error.message||'Creator challenges could not be loaded.';}
  }

  creatorShowDeleted.addEventListener('click',()=>{
    creatorShowDeletedRows=!creatorShowDeletedRows;
    void loadCreatorChallenges();
  });

  update();
  await Promise.all([loadExisting(),loadPublishAvailability(),typeof draftRequest==='function'?loadCreatorChallenges():Promise.resolve()]);
}
