// Retry reads only. Writes need operation-specific reconciliation, because a
// timeout or 5xx response does not prove that the provider rolled back a write.
export const transientControlStatus = status => [423, 429, 500, 502, 503, 504].includes(status);
export async function controlRequest(url, {provider, token, method='GET', body,
  allow404=false, fetcher=fetch, sleep=ms=>new Promise(r=>setTimeout(r,ms)), attempts=4}={}) {
  for(let attempt=0;attempt<attempts;attempt++) {
    let response, result, failure;
    try {
      response=await fetcher(url,{method,redirect:'error',headers:{authorization:`Bearer ${token}`,
        'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
        signal:AbortSignal.timeout(30000)});
      if(allow404&&response.status===404)return null;
      if(response.ok) {
        const text=await response.text();
        result=text.trim()?JSON.parse(text):null;
        return result;
      }
      failure=new Error(`${provider} control HTTP ${response.status}.`);
      failure.status=response.status;
    } catch {
      failure=new Error(`${provider} control request failed.`);
    }
    if(method!=='GET'||(response&&!transientControlStatus(response.status))||attempt===attempts-1)throw failure;
    await sleep(1000*2**attempt);
  }
}
