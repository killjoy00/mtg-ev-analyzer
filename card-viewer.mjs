import {cardDisplayFaces,cardFaceIndicator,faceLabel} from './card-faces.mjs';
import {escapeHtml as esc} from './html.mjs';

export function faceIndicatorMarkup(card) {
  const text=cardFaceIndicator(card);
  return text?`<span class="card-face-indicator">${esc(text)}</span>`:'';
}

export function openCardViewer(card) {
  if(!card)return;
  if(!document.querySelector('[data-card-viewer-style]')) {
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./card-viewer.css?v=1',import.meta.url).href;
    link.dataset.cardViewerStyle='1';document.head.append(link);
  }
  const returnFocus=document.activeElement,faces=cardDisplayFaces(card);
  const dialog=document.createElement('dialog');
  dialog.className='run-card-dialog card-face-dialog';
  dialog.setAttribute('aria-label',`Enlarged card: ${card.name}`);
  dialog.innerHTML=`<div class="card-face-header"><strong>${esc(card.name)}</strong><button type="button" class="button secondary" data-card-close autofocus>Close</button></div>
    ${faces.length===2?'<button type="button" class="button secondary card-face-toggle" data-face-toggle></button>':''}
    <div class="card-face-panels">${faces.map((face,index)=>`<figure class="card-face-panel" data-face="${index}">
      <figcaption><span>${faces.length===2?esc(faceLabel(face))+' · ':''}${esc(face.name)}</span></figcaption>
      <div class="card-face-art"><img alt="${esc(face.name)} — ${esc(faceLabel(face))}" src="${esc(face.large_image_url||face.image_url)}">
      <div class="card-face-error" hidden><p role="status">Image unavailable for ${esc(face.name)}.</p><button type="button" class="button secondary" data-face-retry="${index}">Retry image</button></div></div>
      ${face.partner_name?`<p class="card-face-note">Melds with ${esc(face.partner_name)}. Both cards are required.</p>`:''}</figure>`).join('')||'<p>Artwork unavailable.</p>'}</div>`;
  let active=0;
  const media=window.matchMedia('(min-width: 760px)'),toggle=dialog.querySelector('[data-face-toggle]');
  const update=()=>{
    dialog.classList.toggle('has-two-faces',faces.length===2);
    dialog.querySelectorAll('[data-face]').forEach((pane,index)=>{pane.hidden=!media.matches&&index!==active;});
    if(toggle) {
      toggle.hidden=media.matches;
      const next=faces[1-active];
      toggle.textContent=`Show ${faceLabel(next).toLowerCase()}`;
      toggle.setAttribute('aria-label',`${toggle.textContent}: ${next.name}`);
    }
  };
  if(toggle)toggle.onclick=()=>{active=1-active;update();};
  dialog.querySelectorAll('[data-face]').forEach((pane,index)=>{
    const face=faces[index],img=pane.querySelector('img'),error=pane.querySelector('.card-face-error');
    let triedNormal=!face.large_image_url;
    img.onerror=()=>{
      if(!triedNormal) {triedNormal=true;img.src=face.image_url;return;}
      img.hidden=true;error.hidden=false;
    };
    pane.querySelector('[data-face-retry]').onclick=()=>{
      error.hidden=true;img.hidden=false;
      img.removeAttribute('src');img.src=face.image_url;
    };
  });
  media.addEventListener('change',update);
  dialog.querySelector('[data-card-close]').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{media.removeEventListener('change',update);dialog.remove();if(returnFocus?.isConnected)returnFocus.focus();},{once:true});
  document.body.append(dialog);update();dialog.showModal();
  return dialog;
}
