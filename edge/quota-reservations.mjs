// Preview experiment: persisted counts include every credit reserved by this
// instance. Eviction forfeits unused credits; it never makes them available to
// a replacement instance. All calls (including alarms and sync) must be serialized.
const STATE='buckets',KEYS=['request','request_burst','session'];
const BLOCK={request:8,request_burst:8,session:2};

function validate(stored) {
  if(!stored||typeof stored!=='object'||Array.isArray(stored))throw Error('Invalid quota state.');
  for(const [key,row] of Object.entries(stored)) {
    if(!KEYS.includes(key)||!row||!Number.isSafeInteger(row.count)||row.count<0||
      !Number.isSafeInteger(row.until)||row.until<0)throw Error('Invalid quota state.');
  }
}

export class QuotaReservations {
  constructor(storage) {this.storage=storage;this.credits={};this.tail=Promise.resolve();}
  exclusive(call) {
    const pending=this.tail.then(call);
    // A failed acknowledgement must forfeit all possibly unconfirmed credits.
    this.tail=pending.then(()=>{},()=>{this.clear();});
    return pending;
  }
  clear() {this.credits={};}
  async debit(limits,now,metric,timed) {
    for(const [key] of limits)if(this.credits[key]?.until<=now)delete this.credits[key];
    const missing=limits.filter(([key])=>!(this.credits[key]?.remaining>0));
    if(missing.length) {
      const result=await timed('transaction_ms',()=>this.storage.transaction(async tx=>{
        metric.transaction_callbacks++;
        let stored=await timed('get_ms',()=>tx.get(STATE));
        if(stored!==undefined&&stored!==null)metric.state_layout='current';
        else {
          stored=Object.fromEntries(await timed('get_ms',()=>tx.get(KEYS)));
          metric.state_layout=Object.keys(stored).length?'legacy':'empty';
        }
        validate(stored);
        const next={...stored},reserved={},scopes=[];let retry=0;
        for(const [key,limit,period] of missing) {
          let row=stored[key];
          if(!row||now>=row.until)row={count:0,until:now+period};
          if(row.count>=limit) {
            retry=Math.max(retry,Math.ceil((row.until-now)/1000));
            const scope=key==='request_burst'?'request':key;
            if(!scopes.includes(scope))scopes.push(scope);
          } else {
            const amount=Math.min(BLOCK[key],limit-row.count);
            next[key]={count:row.count+amount,until:row.until};
            reserved[key]={remaining:amount,until:row.until};
          }
        }
        if(retry)return {retry,scopes}; // no partial write or credit debit
        await timed('put_ms',()=>tx.put(STATE,next));
        if(await timed('alarm_get_ms',()=>tx.getAlarm())===null)
          await timed('alarm_set_ms',()=>tx.setAlarm(now+660000));
        return {retry:0,scopes,reserved};
      }));
      if(result.retry)return result;
      // Callback retries never modify instance credit. The caller still holds
      // the exclusive queue through sync(); failure clears this tentative state.
      Object.assign(this.credits,result.reserved);
      metric.reservation_write=true;
    } else metric.state_layout='reserved';
    for(const [key] of limits)this.credits[key].remaining--;
    return {retry:0,scopes:[]};
  }
}
