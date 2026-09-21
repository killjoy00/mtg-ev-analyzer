import fs from 'node:fs';

const EXPECTED_EMAIL='account-deletion@packone.pro';
const PROJECT_ID='patient-shadow-91417882';
const PROD_BRANCH='br-orange-feather-ayps8kep';
const email=String(process.env.PACK1_DELETION_ADMIN_EMAIL||'').trim().toLowerCase();
const password=String(process.env.PACK1_DELETION_ADMIN_PASSWORD||'');
const apiKey=String(process.env.NEON_API_KEY||'');
const idFile=String(process.env.PACK1_DELETION_ADMIN_ID_FILE||'');

function fail(message){throw new Error(message);}
if(email!==EXPECTED_EMAIL)fail('Deletion service-principal email is missing or does not match the reviewed non-human identity.');
if(password.length<24)fail('Deletion service-principal password is missing or too short.');
if(apiKey.length<10)fail('Neon management credential is unavailable.');
if(!idFile)fail('Service-principal id output path is unavailable.');

const configResponse=await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT_ID}/branches/${PROD_BRANCH}/auth`,{
  headers:{authorization:`Bearer ${apiKey}`,accept:'application/json'},
  signal:AbortSignal.timeout(15000),
});
if(!configResponse.ok)fail(`Could not resolve production Auth configuration (HTTP ${configResponse.status}).`);
const config=await configResponse.json();
const base=String(config.base_url||'').replace(/\/$/,'');
if(!/^https:\/\/[^/]+\/[^/]+\/auth$/.test(base))fail('Production Auth base URL was malformed.');

async function authCall(path,body){
  const response=await fetch(base+path,{
    method:'POST',
    headers:{origin:'https://packone.pro',accept:'application/json','content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>({}));
  return {response,data};
}

let result=await authCall('/sign-in/email',{email,password,rememberMe:false});
if(!result.response.ok){
  if(![400,401,404].includes(result.response.status))
    fail(`Production service-principal sign-in was unavailable (HTTP ${result.response.status}).`);
  result=await authCall('/sign-up/email',{
    name:'Pack One Account Deletion Service',
    email,
    password,
  });
  if(!result.response.ok)
    fail(`Production service-principal provisioning failed (HTTP ${result.response.status}).`);
}

const userId=String(result.data?.user?.id||'');
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))
  fail('Managed Auth did not return an unambiguous service-principal identity.');

fs.writeFileSync(idFile,userId,{encoding:'utf8',mode:0o600});
console.log('Managed Auth service-principal credential is valid.');
