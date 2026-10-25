import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
 buildFeaturedSoundtrack,FEATURED_AUDIO_SECONDS,FEATURED_AUDIO_SAMPLE_RATE,
 FEATURED_AUDIO_VERSION,FEATURED_AUDIO_CUE_TIMES,
} from '../scripts/featured-soundtrack.mjs';

test('creates an original, valid 20-second PCM soundtrack with reasonable loudness',()=>{
 const {wav,stats}=buildFeaturedSoundtrack();
 const frames=FEATURED_AUDIO_SECONDS*FEATURED_AUDIO_SAMPLE_RATE;
 assert.equal(wav.subarray(0,4).toString('ascii'),'RIFF');
 assert.equal(wav.subarray(8,12).toString('ascii'),'WAVE');
 assert.equal(wav.subarray(12,16).toString('ascii'),'fmt ');
 assert.equal(wav.readUInt16LE(20),1); // PCM
 assert.equal(wav.readUInt16LE(22),1); // mono; AAC encoder converts to stereo
 assert.equal(wav.readUInt32LE(24),FEATURED_AUDIO_SAMPLE_RATE);
 assert.equal(wav.readUInt16LE(34),16);
 assert.equal(wav.readUInt32LE(40),frames*2);
 assert.equal(wav.length,44+frames*2);
 assert.equal(stats.version,FEATURED_AUDIO_VERSION);
 assert.equal(stats.original_composition,true);
 assert.deepEqual(stats.cues_seconds,[2,5,9,13,17]);
 assert.ok(stats.rms_dbfs>-35&&stats.rms_dbfs< -11,JSON.stringify(stats));
 assert.ok(stats.peak_dbfs<= -2,JSON.stringify(stats));
 const ending=wav.readInt16LE(wav.length-2);
 assert.ok(Math.abs(ending)<=400,'The outro should fade to zero, not click.');
});

test('the soundtrack is deterministic, self-contained, and rejects arbitrary durations',()=>{
 const a=buildFeaturedSoundtrack().wav;
 const b=buildFeaturedSoundtrack().wav;
 const digest=buf=>createHash('sha256').update(buf).digest('hex');
 assert.equal(digest(a),digest(b));
 assert.throws(()=>buildFeaturedSoundtrack({durationSeconds:21}),/20-second/);
 assert.throws(()=>buildFeaturedSoundtrack({sampleRate:44100}),/20-second/);
});

test('YouTube renderer encodes AAC with the scene-timed score and verifies the MP4 tracks',()=>{
 const src=readFileSync('scripts/render-featured-pick.mjs','utf8');
 assert.match(src,/buildFeaturedSoundtrack\(\)/);
 assert.match(src,/featured-original-music\.wav/);
 assert.match(src,/'-c:a','aac'/);
 assert.match(src,/audio\?\.codec_name!=='aac'/);
 assert.match(src,/audio_track:true,audio_source:FEATURED_AUDIO_VERSION/);
 assert.doesNotMatch(src,/'-an'/);
});

test('publisher fails closed for a missing soundtrack; standard Daily video stays separate',()=>{
 const publisher=readFileSync('scripts/publish-featured-pick.mjs','utf8');
 const standard=readFileSync('scripts/upload-daily-short.mjs','utf8');
 assert.match(publisher,/render\.audio_track!==true/);
 assert.match(publisher,/render\.audio_source!==FEATURED_AUDIO_VERSION/);
 assert.match(publisher,/render\.audio_stats\?\.original_composition!==true/);
 assert.doesNotMatch(standard,/featured-original-music/);
});
