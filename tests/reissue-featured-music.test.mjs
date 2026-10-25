import test from 'node:test';
import assert from 'node:assert/strict';
import {VIDEO_REISSUE_DAY,SOURCE_DAY,CORRECT_PUZZLE_ID,
 validateReissueEnvironment,validateFeaturedMusicReissue,scoredReissueMetadata,
} from '../scripts/reissue-featured-music-once.mjs';
import {FEATURED_AUDIO_VERSION} from '../scripts/featured-soundtrack.mjs';
const environment={
 GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',
 GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_RUN_ATTEMPT:'1',
 GITHUB_TOKEN:'not-real-token',
};
const now=new Date('2026-10-25T16:00:00Z');
const feature={
 day:SOURCE_DAY,puzzle_id:CORRECT_PUZZLE_ID,environment:'mixed',
 tier:3,round:2,pick_number:2,players:284,
 trophy:{id:'super-villain-lockup',name:'Super Villain Lockup',pct:29.9},
 choices:[
  {id:'web-up',name:'Web Up',pct:31},
  {id:'super-villain-lockup',name:'Super Villain Lockup',pct:29.9},
  {id:'thor-odinson',name:'Thor Odinson',pct:29.6},
 ]};
const render={day:SOURCE_DAY,puzzle_id:CORRECT_PUZZLE_ID,
 real_card_art:true,audio_track:true,audio_source:FEATURED_AUDIO_VERSION,
 audio_stats:{original_composition:true},duration_seconds:20};

test('reissue is permitted only on the explicitly reviewed day, first-attempt push on main',()=>{
 assert.equal(VIDEO_REISSUE_DAY,'2026-10-25');
 assert.equal(validateReissueEnvironment(environment,now),true);
 assert.throws(()=>validateReissueEnvironment({...environment,GITHUB_EVENT_NAME:'schedule'},now));
 assert.throws(()=>validateReissueEnvironment({...environment,GITHUB_RUN_ATTEMPT:'2'},now));
 assert.throws(()=>validateReissueEnvironment({...environment,GITHUB_REF:'refs/heads/testing'},now));
 assert.throws(()=>validateReissueEnvironment(environment,new Date('2026-10-26T16:00:00Z')));
});

test('only corrected three-card debate with exact original audio may upload',()=>{
 assert.equal(validateFeaturedMusicReissue(feature,render),true);
 assert.throws(()=>validateFeaturedMusicReissue({...feature,puzzle_id:'bad'},render));
 assert.throws(()=>validateFeaturedMusicReissue({...feature,trophy:{id:'fourth'}},render));
 assert.throws(()=>validateFeaturedMusicReissue(feature,{...render,audio_track:false}));
 assert.throws(()=>validateFeaturedMusicReissue(feature,{...render,audio_source:'not-music'}));
 assert.throws(()=>validateFeaturedMusicReissue(feature,{...render,day:'2026-10-23'}));
});

test('reissued YouTube title identifies music edit and preserves public intended visibility',()=>{
 const meta=scoredReissueMetadata(feature);
 assert.ok(meta.snippet.title.includes('With Music'));
 assert.ok(meta.snippet.title.length<=100);
 assert.equal(meta.status.privacyStatus,'public');
});
