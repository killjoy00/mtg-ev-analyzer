// Owner-only section; text rendered as text, not trusted model HTML or Markdown.
// Render the exact immutable body blocks and deterministic SVG images as
// images, never inject model prose or SVG into the document markup.
export function renderLabPreview(article,doc=document){
  const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const post=el('div');post.className='lab-post-preview';
  const svgImage=(value,alt)=>{
    if(typeof value!=='string'||value.length>50000||!value.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))throw Error('Invalid Lab artwork');
    const img=el('img');img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(value);
    img.alt=alt;img.className='lab-post-art';return img;
  };
  if(article.schema_version===2&&Array.isArray(article.blocks)&&article.artwork){
    post.append(svgImage(article.artwork.cover_svg,'Pack One Lab — '+article.title));
    post.append(el('h3',article.title),el('p',article.series+' · '+(article.sets||[article.set]).join(' / ')));
    for(const block of article.blocks){
      if(block.type==='chart')post.append(svgImage(article.artwork.chart_svg,article.artwork.chart_alt));
      else if(block.type==='outcome-chart')post.append(svgImage(article.artwork.outcome_chart_svg,article.artwork.outcome_chart_alt));
      else if(block.type==='heading')post.append(el('h4',block.text));
      else if(['paragraph','facts','note'].includes(block.type)){
        const node=el('p',block.text);node.className='lab-post-'+block.type;post.append(node);
      }else throw Error('Unknown Lab article block');
    }
    const source=el('p',article.source);source.className='lab-post-note';post.append(source);
  }else{
    for(const paragraph of String(article.body||'').split('\n\n'))post.append(el('p',paragraph));
    const chart=el('figure');chart.append(el('figcaption','Research findings'));
    for(const m of article.chart||[]){
      if(!Number.isFinite(m.percent)||m.percent<0||m.percent>100)continue;
      const row=el('div'),label=el('p',m.label+': '+m.percent.toFixed(1)+'% ('+m.numerator+' of '+m.denominator+')');
      const meter=el('meter');meter.min=0;meter.max=100;meter.value=m.percent;meter.setAttribute('aria-label',m.label);
      row.append(label,meter);chart.append(row);
    }
    post.append(chart,el('p',article.source));
  }
  return post;
}
export async function renderLab(root,request){
  if(!root)return;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const show=async()=>{
    root.replaceChildren(el('h2','Pack One Lab'),el('p','Loading private review queue…'));
    let data;
    try{data=await request('/v1/admin/lab');}catch{root.replaceChildren(el('h2','Pack One Lab'),el('p','Review queue unavailable.'));return;}
    root.replaceChildren(el('h2','Pack One Lab'));
    root.append(el('p',data.publishing_available?'Only approved articles can be sent by the Pack One Patreon Publisher.':'Publishing is disabled. Approval saves the article and publication time.'));
    const refresh=el('button','Refresh');refresh.type='button';refresh.onclick=()=>void show();root.append(refresh);
    const research=Array.isArray(data.research)?data.research:[];
    for(const item of research)root.append(el('p','Stored corpus research: '+({ready:'Verified and available',preparing:'Preparation in progress',failed:'Preparation failed; retry on next scheduled run'}[item.state]||'Unavailable')));
    if(!research.length)root.append(el('p','Stored pick research has not run yet.'));
    for(const task of data.tasks||[])root.append(el('p',(task.scope==='samples'?'Sample articles':'Article generation')+' · '+task.week+': '+task.written+' of '+task.requested+' drafts received; '+task.passed+' passed editorial review.'));
    if(data.samples){
      const batch=data.samples,group=el('section');group.className='subpage-section';
      group.append(el('h3','Sample articles'),el('p',batch.articles.length+' of 5 generated. Private samples only; they cannot be published.'));
      for(const entry of batch.articles){
        const details=el('details'),summary=el('summary',entry.article.title);
        details.append(summary);
        try{details.append(renderLabPreview(entry.article));}catch{details.append(el('p','Preview unavailable.'));}
        group.append(details);
      }
      root.append(group);
    }
    const issues=Array.isArray(data.issues)?data.issues:[];
    if(!issues.length){root.append(el('p','No article awaiting review.'));return;}
    for(const issue of issues){
      const section=el('article');section.className='subpage-section';
      section.append(el('h3',issue.article?.title||'Week of '+issue.week),el('p','Week of '+issue.week+' · '+issue.state.replaceAll('_',' ')+' · revision '+issue.revision));
      if(issue.article){
        section.append(el('p','Post preview (native Patreon layout may differ)'));
        try{section.append(renderLabPreview(issue.article));}
        catch{section.append(el('p','Preview unavailable. Do not approve this version.'));root.append(section);continue;}
        section.append(el('p','Version: '+issue.hash));
      }
      if(issue.state==='approved'){
        const pub=issue.publication;
        const state=pub?({claimed:'Publication claimed',handoff:'Awaiting verification',queued:'Queued; awaiting verification',review:'Publication needs review; no automatic retry',verified:'Publication verified'}[pub.state]||'Publication status unavailable'):'Not submitted';
        section.append(el('p','Approved for '+new Date(issue.publish_at).toLocaleString('en-US',{timeZone:'America/Chicago'})+' CT. '+state+'.'));
        if(pub?.state==='verified'&&/^https:\/\/www\.patreon\.com\/posts\/\d+$/.test(pub.public_url||'')){const link=el('a','View published post');link.href=pub.public_url;section.append(link);}
      }
      if(issue.state==='review'&&issue.article){
        section.append(el('p',issue.notification_sent_at?'Review email accepted by provider.':issue.notification_claimed_at?'Email delivery requires verification.':'Review email not yet sent.'));
        const label=el('label','Revision feedback');const feedback=el('textarea');feedback.maxLength=1500;label.append(feedback);section.append(label);
        const status=el('p');status.setAttribute('role','status');const buttons=[];
        for(const [action,title] of [['approve','Approve for Friday'],['approve_now','Approve for immediate publication when available'],['revise','Request revision'],['alternative','Choose another topic'],['skip','Skip this week']]){
          const button=el('button',title);button.type='button';buttons.push(button);section.append(button);
          button.onclick=async()=>{
            buttons.forEach(b=>b.disabled=true);status.textContent='Saving…';
            try{await request('/v1/admin/lab/review',{week:issue.week,revision:issue.revision,hash:issue.hash,action,feedback:action==='revise'?feedback.value:''});await show();}
            catch{status.textContent='Unable to save. Refresh the article before trying again.';buttons.forEach(b=>b.disabled=false);}
          };
        }
        section.append(status);
      }
      root.append(section);
    }
  };
  await show();
}
