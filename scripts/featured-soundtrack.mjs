// Original, reproducible soundtrack for the 20-second Pack One featured Short.
// All sound is synthesized here: no external recordings, samples or music licensing.
export const FEATURED_AUDIO_VERSION='packone-original-synth-v1';
export const FEATURED_AUDIO_SECONDS=20;
export const FEATURED_AUDIO_SAMPLE_RATE=32000;
export const FEATURED_AUDIO_CUE_TIMES=Object.freeze([2,5,9,13,17]);
const TAU=2*Math.PI;

function frequency(midi) {return 440*Math.pow(2,(midi-69)/12);}
const CHORDS=Object.freeze([
 [57,60,64], // A minor
 [53,57,60], // F major
 [60,64,67], // C major
 [55,59,62], // G major
 [57,60,64],
 [53,57,60],
 [60,64,67],
 [55,59,62],
 [57,60,64],
 [52,56,59], // E major, homeward resolution
]);

// No network or filesystem I/O. Output is an ordinary 16-bit PCM mono WAV.
// Samples remain intentionally soft: the music underlines the card decision,
// the vote reveal has a little lift, and the trophy reveal has a light flourish.
export function buildFeaturedSoundtrack({
 durationSeconds=FEATURED_AUDIO_SECONDS,
 sampleRate=FEATURED_AUDIO_SAMPLE_RATE,
}={}) {
 if(durationSeconds!==FEATURED_AUDIO_SECONDS||sampleRate!==FEATURED_AUDIO_SAMPLE_RATE)
  throw Error('Featured Short requires the reviewed 20-second soundtrack contract.');
 const length=durationSeconds*sampleRate;
 const signal=new Float32Array(length);
 const index=t=>Math.max(0,Math.round(t*sampleRate));
 const addTone=(at,seconds,hz,volume,{attack=.008,release=.085,decay=0,warmth=.22}={})=>{
  if(!Number.isFinite(hz)||hz<50||hz>3500)throw Error('Unsafe soundtrack pitch.');
  const start=index(at),end=Math.min(length,index(at+seconds));
  for(let i=start;i<end;i++){
   const t=(i-start)/sampleRate;
   const remain=(end-i)/sampleRate;
   const env=Math.min(1,t/attack,remain/release)*
    (decay?Math.exp(-t/decay):1);
   const phase=TAU*hz*t;
   const sound=(Math.sin(phase)+warmth*Math.sin(2*phase)*.65+
    .08*Math.sin(3*phase))*(1/(1+warmth*.65+.08));
   signal[i]+=sound*volume*env;
  }
 };
 const addSoftNoise=(at,seconds,volume,falloff=12)=>{
  const start=index(at),end=Math.min(length,index(at+seconds));
  let seed=(Math.round(at*1000)+3475131)>>>0;
  for(let i=start;i<end;i++){
   seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
   const t=(i-start)/sampleRate;
   const remain=(end-i)/sampleRate;
   const fade=Math.min(1,t/.003,remain/.025);
   signal[i]+=((seed>>>0)/4294967296*2-1)*volume*Math.exp(-falloff*t)*fade;
  }
 };
 // 120 BPM, 10 bars. Warm triad pads + an original eight-note arpeggio.
 for(let bar=0;bar<10;bar++){
  const at=bar*2,chord=CHORDS[bar];
  for(const note of chord)
   addTone(at,1.92,frequency(note),.020,{attack:.14,release:.40,warmth:.08});
  // An airy, syncopated pluck that doesn't interfere with draft copy.
  const motif=[0,1,2,1,0,2,1,2];
  for(let step=0;step<8;step++)
   addTone(at+step*.25,.22,frequency(chord[motif[step]]+12),
    bar>=4&&bar<=7?.064:.052,{attack:.006,release:.07,decay:.15,warmth:.35});
  for(const beat of [0,1]){
   const t=at+beat;
   addTone(t,.25,frequency(chord[0]-12),.065,
    {attack:.007,release:.08,decay:.15,warmth:.30});
   // Muted kick under the arpeggio, not an aggressive drum loop.
   addTone(t,.16,88,.040,{attack:.003,release:.07,decay:.07,warmth:0});
   addSoftNoise(t+.5,.075,.025,24);
  }
 }
 // Small, recognizable UI cues exactly where the on-screen scenes change.
 for(const [k,t] of FEATURED_AUDIO_CUE_TIMES.entries()){
  addSoftNoise(t,.16,k===3?.055:.033,13);
  addTone(t,.24,k===3?880:590,.025,{attack:.003,release:.07,decay:.11});
 }
 // The trophy reveal at 13 s gets a cheerful three-note flourish.
 for(const [i,note] of [72,76,79].entries())
  addTone(13+i*.12,.60,frequency(note),.079,
   {attack:.006,release:.17,decay:.36,warmth:.18});
 // Gently settle the CTA and leave no sudden cut at 20 seconds.
 let peak=0;
 for(let i=0;i<length;i++){
  const t=i/sampleRate;
  const fadeIn=Math.min(1,t/.33);
  const fadeOut=Math.min(1,(durationSeconds-t)/.80);
  signal[i]*=Math.max(0,Math.min(fadeIn,fadeOut));
  peak=Math.max(peak,Math.abs(signal[i]));
 }
 if(!(peak>.005))throw Error('No meaningful soundtrack signal generated.');
 const gain=Math.min(2.6,.72/peak);
 const dataBytes=length*2;
 const wav=Buffer.allocUnsafe(44+dataBytes);
 wav.write('RIFF',0,'ascii');
 wav.writeUInt32LE(36+dataBytes,4);
 wav.write('WAVE',8,'ascii');
 wav.write('fmt ',12,'ascii');
 wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);
 wav.writeUInt16LE(1,22);
 wav.writeUInt32LE(sampleRate,24);
 wav.writeUInt32LE(sampleRate*2,28);
 wav.writeUInt16LE(2,32);
 wav.writeUInt16LE(16,34);
 wav.write('data',36,'ascii');
 wav.writeUInt32LE(dataBytes,40);
 let sumSquares=0,maxAmplitude=0;
 for(let i=0;i<length;i++){
  const val=Math.max(-.95,Math.min(.95,signal[i]*gain));
  sumSquares+=val*val;
  maxAmplitude=Math.max(maxAmplitude,Math.abs(val));
  wav.writeInt16LE(Math.round(val*32767),44+2*i);
 }
 const rms=Math.sqrt(sumSquares/length);
 const rmsDbfs=20*Math.log10(rms);
 const peakDbfs=20*Math.log10(maxAmplitude);
 if(rmsDbfs< -35||rmsDbfs> -11||peakDbfs> -2||
    !Number.isFinite(rmsDbfs)||!Number.isFinite(peakDbfs))
  throw Error('Original soundtrack failed the reviewed loudness envelope.');
 return {wav,stats:{
  version:FEATURED_AUDIO_VERSION,duration_seconds:durationSeconds,
  sample_rate:sampleRate,channels:1,peak_dbfs:+peakDbfs.toFixed(1),
  rms_dbfs:+rmsDbfs.toFixed(1),cues_seconds:[...FEATURED_AUDIO_CUE_TIMES],
  original_composition:true,
 }};
}
