// Foreground time for one visit to one decision. Never time feedback screens.
export function decisionClock(now=()=>performance.now()) {
  let key=null,id=null,total=0,since=null;
  const pause=()=>{if(since!==null){total+=Math.max(0,now()-since);since=null;}};
  return {
    show(next,visible=true){if(key!==next){pause();key=next;id=crypto.randomUUID();total=0;}if(visible&&since===null)since=now();return id;},
    pause,
    resume(){if(key&&since===null)since=now();},
    clear(){pause();key=null;id=null;total=0;},
    sample(){return {viewId:id,activeMs:Math.round(total+(since===null?0:Math.max(0,now()-since)))};}
  };
}
