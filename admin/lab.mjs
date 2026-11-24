// Owner-only section; text rendered as text, not trusted model HTML or Markdown.
export async function renderLab(root,request){
  if(!root)return;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const show=async()=>{
    root.replaceChildren(el('h2','Pack One Lab'),el('p','Loading private review queue…'));
    let data;
    try{data=await request('/v1/admin/lab');}catch{root.replaceChildren(el('h2','Pack One Lab'),el('p','Review queue unavailable.'));return;}
    root.replaceChildren(el('h2','Pack One Lab'));
    root.append(el('p','Review Magic drafting research. Publishing is not connected yet; approval saves the exact version and requested time only.'));
    const refresh=el('button','Refresh');refresh.type='button';refresh.onclick=()=>void show();root.append(refresh);
    const research=Array.isArray(data.research)?data.research:[];
    for(const item of research)root.append(el('p','Stored corpus research: '+({ready:'Verified and available',preparing:'Preparation in progress',failed:'Preparation failed; retry on next scheduled run'}[item.state]||'Unavailable')));
    if(!research.length)root.append(el('p','Stored pick research has not run yet.'));
    const issues=Array.isArray(data.issues)?data.issues:[];
    if(!issues.length){root.append(el('p','No article awaiting review.'));return;}
    for(const issue of issues){
      const section=el('article');section.className='subpage-section';
      section.append(el('h3',issue.article?.title||'Week of '+issue.week),el('p','Week of '+issue.week+' · '+issue.state.replaceAll('_',' ')+' · revision '+issue.revision));
      if(issue.article){
        for(const paragraph of String(issue.article.body||'').split('\n\n'))section.append(el('p',paragraph));
        const chart=el('figure');chart.append(el('figcaption','Research findings'));
        for(const m of issue.article.chart||[]){
          if(!Number.isFinite(m.percent)||m.percent<0||m.percent>100)continue;
          const row=el('div'),label=el('p',m.label+': '+m.percent.toFixed(1)+'% ('+m.numerator+' of '+m.denominator+')');
          const meter=el('meter');meter.min=0;meter.max=100;meter.value=m.percent;meter.setAttribute('aria-label',m.label);
          row.append(label,meter);chart.append(row);
        }
        section.append(chart,el('p',issue.article.source),el('p','Version: '+issue.hash));
      }
      if(issue.state==='approved')section.append(el('p','Approved for '+new Date(issue.publish_at).toLocaleString('en-US',{timeZone:'America/Chicago'})+' CT. No post has been sent.'));
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
