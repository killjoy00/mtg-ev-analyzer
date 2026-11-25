// Original, quiet instrumental for #1805. No external samples, narration or
// licensed music. Timing follows each decision's actual scene boundaries.
export function buildMotionSoundtrack(seconds,cues=[]){
 if(!Number.isFinite(seconds)||seconds<20||seconds>45)throw Error('Invalid soundtrack length');
 const rate=32000,length=Math.round(seconds*rate),wave=new Float32Array(length),tau=2*Math.PI;
 const hz=n=>440*2**((n-69)/12);
 const tone=(at,dur,pitch,volume,{attack=.08,release=.25,pluck=0}={})=>{
  const a=Math.round(at*rate),b=Math.min(length,a+Math.round(dur*rate));
  for(let i=Math.max(0,a);i<b;i++){
   const t=(i-a)/rate,remain=(b-i)/rate,env=Math.min(1,t/attack,remain/release)*Math.exp(-pluck*t);
   const phase=tau*hz(pitch)*t;
   wave[i]+=volume*env*(Math.sin(phase)+.10*Math.sin(2*phase)+.025*Math.sin(3*phase))/1.125;
  }
 };
 const chords=[[50,57,62,65],[46,53,58,62],[48,55,60,64],[45,52,57,60]];
 // Sparse soft pads and felt-piano-like tones. No beep on every count.
 for(let at=0,bar=0;at<seconds;at+=3.2,bar++){
  const notes=chords[bar%chords.length];
  for(const n of notes)tone(at,Math.min(3.5,seconds-at),n,.030,{attack:.6,release:.8});
  for(let i=0;i<4;i++)if(at+.4+i*.8<seconds)
   tone(at+.4+i*.8,Math.min(1.15,seconds-at-.4-i*.8),notes[[1,2,3,2][i]]+12,.040,{attack:.012,release:.3,pluck:2.4});
  tone(at,Math.min(1.8,seconds-at),notes[0]-12,.036,{attack:.15,release:.6,pluck:.8});
 }
 // Only a small musical accent on community reveal and trophy reveal.
 for(const cue of cues.filter(c=>c.kind==='results'||c.kind==='trophy')){
  for(const [i,n] of [69,74,77].entries())if(cue.at+i*.1<seconds)
   tone(cue.at+i*.1,Math.min(.65,seconds-cue.at-i*.1),n,.035,{attack:.03,release:.30,pluck:2});
 }
 let peak=0,sum=0;
 for(let i=0;i<length;i++){
  const t=i/rate;wave[i]*=Math.min(1,t/.4,(seconds-t)/.85);
  peak=Math.max(peak,Math.abs(wave[i]));sum+=wave[i]**2;
 }
 const rms=Math.sqrt(sum/length),gain=Math.min(.32/peak,.08/rms,2);
 const wav=Buffer.alloc(44+length*2);
 wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
 wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(length*2,40);
 for(let i=0;i<length;i++)wav.writeInt16LE(Math.round(wave[i]*gain*32767),44+i*2);
 const stats={version:'motion-instrumental-v1',duration_seconds:seconds,peak_dbfs:20*Math.log10(peak*gain),rms_dbfs:20*Math.log10(rms*gain),narration:false,original:true};
 if(!Number.isFinite(stats.rms_dbfs)||stats.rms_dbfs< -35||stats.rms_dbfs> -18||stats.peak_dbfs> -8)throw Error('Soundtrack outside quiet loudness envelope');
 return {wav,stats};
}
