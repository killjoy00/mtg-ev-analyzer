// A return destination is a path, never an arbitrary URL or an OAuth state value.
const AREAS=new Set(['corpus','users','campaign-links']);
const FILTERS=new Set(['from','to','environment','type','set','version','difficulty','pick']);
export function sanitizeAdminDestination(value,origin='https://packone.pro') {
  if(typeof value!=='string'||value.length>1000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f]/.test(value))return null;
  let url;
  try {url=new URL(value,origin);}catch{return null;}
  if(url.origin!==origin||!['/admin/','/admin/index.html'].includes(url.pathname)||url.hash||url.username||url.password)return null;
  const clean=new URLSearchParams();
  for(const [key,value] of url.searchParams) {
    if(clean.has(key))return null;
    if(key==='area'){if(!AREAS.has(value))return null;}
    else if(FILTERS.has(key)) {
      if(!/^[a-zA-Z0-9_-]{1,60}$/.test(value))return null;
    } else return null;
    clean.set(key,value);
  }
  return '/admin/'+(clean.size?'?'+clean.toString():'');
}
