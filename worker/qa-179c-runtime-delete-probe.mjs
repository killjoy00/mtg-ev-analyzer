import {createHmac,timingSafeEqual} from 'node:crypto';

const CHALLENGE='179c1-runtime-delete-privilege-probe-v1';

function dbUrl() {
  const url = new URL(process.env.DATABASE_URL);
  const parts = url.hostname.split('.');
  parts[0] = 'api';
  return `https://${parts.join('.')}/sql`;
}

async function query(sql, params = []) {
  const response = await fetch(dbUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': process.env.DATABASE_URL,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query: sql, params: params.map((value) => (value == null ? null : String(value))) }),
  });
  if (!response.ok) throw new Error(`Database query failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const names = (data.fields || []).map((field) => field.name);
  return {
    rows: (data.rows || []).map((row) => Object.fromEntries(row.map((value, index) => [names[index], value]))),
    rowCount: Number(data.rowCount || 0),
  };
}

function json(value,status=200) {
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
}

function authorized(request) {
  if(process.env.PACK1_179C_PRIVILEGE_PROBE!=='1')return false;
  const secret=String(process.env.PACK1_RATE_LIMIT_SECRET||'');
  const got=String(request.headers.get('x-pack1-probe-proof')||'');
  if(secret.length<32||!/^[a-f0-9]{64}$/i.test(got))return false;
  const expected=createHmac('sha256',secret).update(CHALLENGE).digest();
  const actual=Buffer.from(got,'hex');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

export default {async fetch(request) {
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/179c1-runtime-delete-privilege-probe'||!authorized(request))
    return json({error:'not found'},404);
  try {
    const before=await query('SELECT count(*)::text AS n FROM neon_auth.verification');
    const deleted=await query('DELETE FROM neon_auth.verification WHERE false RETURNING id');
    const after=await query('SELECT count(*)::text AS n FROM neon_auth.verification');
    const beforeCount=Number(before.rows[0]?.n||0),afterCount=Number(after.rows[0]?.n||0);
    if(deleted.rowCount!==0||beforeCount!==afterCount)return json({ok:false,code:'ROW_COUNT_CHANGED'},500);
    return json({ok:true,delete_row_count:deleted.rowCount,before_count:beforeCount,after_count:afterCount});
  } catch(error) {
    const text=String(error?.message||'');
    const code=/insufficient_privilege|permission denied/i.test(text)?'INSUFFICIENT_PRIVILEGE':'PROBE_FAILED';
    return json({ok:false,code},500);
  }
}};