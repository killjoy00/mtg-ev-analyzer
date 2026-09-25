import {execFileSync} from 'node:child_process';

// Version numbers restart when an inherited function is shadowed. Compare the
// deployment's creation time and terminal state, never parent/child version IDs.
export function freshDeployment(fn,started) {
  const current=fn?.current_deployment;
  if(!current||Date.parse(current.created_at)<started-5000||!Number.isFinite(Date.parse(current.created_at)))return false;
  if(current.status==='failed')throw Error('Neon control deployment build failed.');
  return current.status==='completed'&&fn.active_deployment?.id===current.id;
}

export async function deployPreviewFunction({branch,slug,directory,environment={},apiKey,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
  if(!/^br-[a-z0-9-]+$/.test(branch||'')||['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(branch)||!/^[a-z0-9]{1,20}$/.test(slug||''))throw Error('Neon control requires an isolated branch and valid function slug.');
  let archive;
  try {archive=execFileSync('zip',['-q','-r','-','.'],{cwd:directory,stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});}catch{throw Error('Neon control source archive failed.');}
  const route=`https://console.neon.tech/api/v2/projects/patient-shadow-91417882/branches/${branch}/functions/${slug}`;
  const request=async(url,options={})=>{
    let response;
    try {response=await fetcher(url,{...options,headers:{authorization:`Bearer ${apiKey}`},redirect:'error',signal:AbortSignal.timeout(120000)});}catch{throw Error('Neon control deployment request failed.');}
    if(!response.ok)throw Error(`Neon control deployment HTTP ${response.status}.`);
    return response;
  };
  const form=new FormData();form.append('zip',new Blob([archive]),'bundle.zip');form.append('runtime','nodejs24');form.append('environment',JSON.stringify(environment));
  const started=Date.now();
  // Never retry this non-idempotent POST; the workflow cleans up on failure.
  await request(route+'/deployments',{method:'POST',body:form});
  for(let attempt=0;attempt<120;attempt++) {
    const body=await (await request(route)).json();
    if(freshDeployment(body.function,started))return;
    await wait(2000);
  }
  throw Error('Neon control timed out waiting for a fresh completed deployment.');
}
