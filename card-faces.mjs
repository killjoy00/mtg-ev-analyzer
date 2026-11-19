import {safeCardImageUrl} from './card-image-policy.mjs';

// Shared by browser, native clients and API serializers. Keep the wire shape
// deliberately small: Scryfall objects and unrelated card parts never leak out.
export function normalizedDisplayFaces(value) {
  if(!Array.isArray(value)||value.length!==2)return [];
  const faces=value.map((face,index)=>{
    if(!face||typeof face.name!=='string'||!face.name.trim()||face.name.length>200)return null;
    const image_url=safeCardImageUrl(face.image_url);
    const role=face.role;
    if(!image_url||(index===0?role!=='front':!['back','meld_result'].includes(role)))return null;
    const result={name:face.name,image_url,role};
    const large=safeCardImageUrl(face.large_image_url);
    if(large)result.large_image_url=large;
    if(role==='meld_result') {
      if(typeof face.partner_name!=='string'||!face.partner_name.trim()||face.partner_name.length>200)return null;
      result.partner_name=face.partner_name;
    }
    return result;
  });
  return faces.every(Boolean)&&faces[0].image_url!==faces[1].image_url?faces:[];
}

export function cardDisplayFaces(card) {
  const faces=normalizedDisplayFaces(card?.display_faces);
  if(faces.length)return faces;
  const image_url=safeCardImageUrl(card?.image_url);
  return image_url?[{name:card?.name||'Card',image_url,role:'front'}]:[];
}

export function cardFaceIndicator(card) {
  const faces=normalizedDisplayFaces(card?.display_faces);
  return faces.length?(faces[1].role==='meld_result'?'Meld result':'2 faces'):'';
}

export function faceLabel(face) {
  return face.role==='meld_result'?'Meld result':face.role==='back'?'Back':'Front';
}
