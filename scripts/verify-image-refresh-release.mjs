// Image maintenance must not deploy application code or run across a partially
// promoted release. These are read-only, cheap health checks, not corpus scans.
import {pathToFileURL} from 'node:url';
const branches=['br-twilight-hill-ayffyd2b','br-orange-feather-ayps8kep'];
const slugs=['draftrunapi','pack1growth','pack1api'];
export async function verifyImageRefreshRelease(fetcher=fetch,expectedCommit='') {
  if(expectedCommit&&!/^[a-f0-9]{40}$/.test(expectedCommit))throw Error('Image refresh blocked: invalid expected release commit');
  let commit;
  for(const branch of branches)for(const slug of slugs) {
    const response=await fetcher(`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech/health?quick=1`,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Image refresh blocked: ${branch}/${slug} health HTTP ${response.status}`);
    const health=await response.json();
    if(health.ok!==true||!/^[a-f0-9]{40}$/.test(health.release_commit||''))throw Error(`Image refresh blocked: ${branch}/${slug} has no verified release marker`);
    commit??=health.release_commit;
    if(health.release_commit!==commit)throw Error('Image refresh blocked: finish the reviewed backend promotion so all development/production functions have the same revision');
  }
  if(expectedCommit&&commit!==expectedCommit)throw Error('Image refresh blocked: backend revision does not match the requested release');
  return commit;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  console.log(`Image refresh backend revision verified: ${await verifyImageRefreshRelease(fetch,process.argv[2]||'')}`);
}
