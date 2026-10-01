export const PUBLIC_IDENTITY_TERMS_VERSION='2026-09-30-v1';
export const PUBLIC_IDENTITY_NOT_ALLOWED_MESSAGE='That leaderboard name is not allowed.';
export const PUBLIC_IDENTITY_REPORT_REASONS=new Set(['offensive_name','harassment','impersonation','spam','other']);

const RESERVED=new Set([
  'admin','administrator','moderator','support','official',
  'pack one','packone','pack one admin','pack one moderator','pack one support','official pack one',
]);

// This deliberately targets only clear high-severity cases. It is not the
// moderation system by itself: report/block/admin review cover context and
// language that a static name filter cannot safely classify.
const CLEARLY_PROHIBITED=[
  /\bf+u+c+k+/,
  /\bs+h+i+t+/,
  /\bc+u+n+t+/,
  /\bn+[i1]+g+g+[e3]+r+/,
  /\bf+[a4]+g+g+[o0]+t+/,
  /\br+[a4]+p+[e3]+/,
  /\bp+[o0]+r+n+/,
  /\bn+[a4]+z+[i1]+/,
];

function skeleton(value) {
  return String(value||'')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g,'')
    .replace(/[@]/g,'a')
    .replace(/[0]/g,'o')
    .replace(/[1!|]/g,'i')
    .replace(/[3]/g,'e')
    .replace(/[4]/g,'a')
    .replace(/[5$]/g,'s')
    .replace(/[7]/g,'t')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .trim()
    .replace(/\s+/g,' ');
}

export function publicIdentityTermsCurrent(row) {
  return Boolean(
    row
    && row.public_identity_terms_version===PUBLIC_IDENTITY_TERMS_VERSION
    && row.public_identity_terms_accepted_at
  );
}

export function publicIdentityHidden(row) {
  return Boolean(row?.public_identity_hidden_at);
}

export function publicDisplayNameProblem(value) {
  const raw=String(value||'');
  if(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(raw))return 'invisible_or_control';
  const key=skeleton(raw);
  if(!key)return 'empty';
  if(RESERVED.has(key))return 'reserved_identity';
  if(/(?:https?:\/\/|www\.|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b)/i.test(raw))return 'contact_or_url';
  if(/(?:\+?\d[\d .()_-]{7,}\d)/.test(raw))return 'contact_or_url';
  if(CLEARLY_PROHIBITED.some(pattern=>pattern.test(key)))return 'clearly_prohibited';
  return null;
}

export function assertPublicDisplayNameAllowed(value) {
  if(publicDisplayNameProblem(value)) {
    throw Object.assign(new Error(PUBLIC_IDENTITY_NOT_ALLOWED_MESSAGE),{status:400,code:'USERNAME_NOT_ALLOWED'});
  }
  return value;
}

export function publicIdentityEligibility(row) {
  if(!row?.auth_user_id)return {eligible:false,reason:'guest'};
  if(publicIdentityHidden(row))return {eligible:false,reason:'moderated'};
  if(!publicIdentityTermsCurrent(row))return {eligible:false,reason:'terms_required'};
  const owned=row.username_owned===true||row.username_owned==='t'||row.username_owned==='true'||row.username_owned===1||row.username_owned==='1';
  if(!owned)return {eligible:false,reason:row.is_placeholder?'username_required':'username_taken'};
  return {eligible:true,reason:null};
}

export function normalizedReportReason(value) {
  const reason=String(value||'').trim().toLowerCase();
  if(!PUBLIC_IDENTITY_REPORT_REASONS.has(reason))throw Object.assign(new Error('Choose a valid report reason.'),{status:400});
  return reason;
}

export function normalizedReportDetails(value) {
  const details=String(value||'').trim();
  if(!details)return null;
  if(details.length>500)throw Object.assign(new Error('Report details must be 500 characters or fewer.'),{status:400});
  return details;
}
