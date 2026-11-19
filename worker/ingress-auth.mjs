import {timingSafeEqual} from 'node:crypto';

// Opt in only on origins whose callers have migrated. A partial configuration
// fails closed, rather than silently reopening the public function URL.
export function guardIngress(request, env=process.env) {
  const required=env.PACK1_REQUIRE_INGRESS,secret=env.PACK1_INGRESS_SECRET;
  if(required===undefined&&secret===undefined)return null;
  if(required!=='1'||!/^[a-f0-9]{64}$/.test(secret||''))
    return Response.json({error:'Ingress unavailable.'},{status:503,headers:{'cache-control':'no-store'}});
  const supplied=request.headers.get('x-pack1-ingress-secret')||'';
  if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(secret),Buffer.from(supplied)))
    return Response.json({error:'Gateway authentication required.'},{status:403,headers:{'cache-control':'no-store'}});
  return null;
}
