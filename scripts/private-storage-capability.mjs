// Narrow, read-only probe of the single approved destination. No token
// inventory, permission changes, response bodies or credential values.
import {ACCOUNT,BUCKET,privateStore,publicFailureCode} from './private-compute-report.mjs';
import {execFileSync} from 'node:child_process';
if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Reviewed main required');
for(const [label,token] of [['existing_edge',process.env.CLOUDFLARE_EDGE_TOKEN],['existing_audit',process.env.CLOUDFLARE_AUDIT_TOKEN]]) {
 if(!token){console.log(label+': unavailable');continue;}
 try {await privateStore({token}).verify();console.log(label+': private configuration verified');}
 catch(error){console.log(label+': '+publicFailureCode(error));}
}
const endpoint=`https://${ACCOUNT}.r2.cloudflarestorage.com`;
if(!process.env.AWS_ACCESS_KEY_ID||!process.env.AWS_SECRET_ACCESS_KEY)console.log('existing_storage: unavailable');
else try {
 execFileSync('aws',['s3api','head-bucket','--bucket',BUCKET,'--endpoint-url',endpoint,'--cli-connect-timeout','10','--cli-read-timeout','30'],
   {stdio:'pipe',env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_DEFAULT_REGION:'auto'},timeout:45000});
 console.log('existing_storage: bucket read available');
}catch {console.log('existing_storage: bucket read unavailable');}
