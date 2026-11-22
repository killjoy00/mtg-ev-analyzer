import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCampaigns,sortCampaigns,sevenDayReturn,MIN_RETURN_SAMPLE} from '../admin/campaign-retention.mjs';

const activity=[
 {source:'reddit',campaign:'first-post',tracked_arrivals:100,daily_completions:12},
 {source:'reddit',campaign:'second-post',tracked_arrivals:200,daily_completions:9},
 {source:'direct',campaign:'(none)',tracked_arrivals:4,daily_completions:33},
 {source:'reddit',campaign:'new',tracked_arrivals:6,daily_completions:3},
];
const cohorts=[
 {source:'reddit',campaign:'first-post',cohort_people:10,seven_day_mature:5,seven_day_returned:2},
 {source:'reddit',campaign:'second-post',cohort_people:33,seven_day_mature:22,seven_day_returned:11},
 {source:'reddit',campaign:'new',cohort_people:6,seven_day_mature:0,seven_day_returned:0},
];

test('campaign first-Daily and seven-day rates reuse the existing Habits numerators and mature denominators',()=>{
 const rows=compareCampaigns(activity,cohorts);
 assert.equal(MIN_RETURN_SAMPLE,20);
 assert.deepEqual(rows.map(r=>[r.firstDaily,r.eligible,r.returned]),[[10,5,2],[33,22,11],[0,0,0],[6,0,0]]);
 assert.deepEqual(sevenDayReturn(rows[0]),{value:'40.0%',note:'2 of 5 came back · Small sample'});
 assert.deepEqual(sevenDayReturn(rows[1]),{value:'50.0%',note:'11 of 22 came back'});
 assert.deepEqual(sevenDayReturn(rows[3]),{value:'Not ready',note:'No full week yet'});
 assert.equal(sevenDayReturn(rows[2]).value,'Not ready');
});

test('missing Habits response is unavailable, not an invented zero-percent return',()=>{
 const row=compareCampaigns(activity,null)[0];
 assert.equal(row.firstDaily,null);assert.equal(row.eligible,null);
 assert.deepEqual(sevenDayReturn(row),{value:'Unavailable',note:'Return report unavailable'});
});

test('sort by first-time players or completed Dailies without losing any campaign',()=>{
 const rows=compareCampaigns(activity,cohorts);
 assert.deepEqual(sortCampaigns(rows,'first').map(r=>r.campaign),['second-post','first-post','new','(none)']);
 assert.deepEqual(sortCampaigns(rows,'completions').map(r=>r.campaign),['(none)','first-post','second-post','new']);
 assert.deepEqual(sortCampaigns(rows,'returns').map(r=>r.campaign),['second-post','first-post','new','(none)']);
 assert.equal(rows.length,activity.length,'changing sort must not remove a campaign');
});

test('campaign/source matches keep unrelated sources separate',()=>{
 const rows=compareCampaigns([{source:'youtube',campaign:'first-post'}],cohorts);
 assert.equal(rows[0].firstDaily,0);
 assert.equal(sevenDayReturn(rows[0]).value,'Not ready');
});
