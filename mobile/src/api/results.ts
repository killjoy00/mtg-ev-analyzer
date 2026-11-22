import {requestJson} from '@/src/api/client';
import {readSession,type MobileSession} from '@/src/storage/session';
export type ResultsSnapshot={active:boolean;launchAt:string|null;emailState:'unanswered'|'on'|'off';excludePublications:boolean};
export async function resultsRequest(session:MobileSession,action?:string){
 const current=await readSession();
 if(!session.accountToken||!session.accountUser?.id||current?.accountToken!==session.accountToken||current.accountUser?.id!==session.accountUser.id)throw Error('Account changed. Open Account settings again.');
 const result=await requestJson<ResultsSnapshot & {presentation?:'prompt'|'notice'|null}>('/growth/v1/mobile/account/results',{
  mobileSessionToken:session.playerToken,mobileAccountToken:session.accountToken,
  ...(action?{method:'PATCH',body:{expectedAccountId:session.accountUser.id,action}}:{}),
 });
 const after=await readSession();
 if(after?.accountToken!==session.accountToken||after.accountUser?.id!==session.accountUser.id)throw Error('Account changed. Open Account settings again.');
 return result;
}
