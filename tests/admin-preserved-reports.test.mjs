import test from 'node:test';
import assert from 'node:assert/strict';
import {habitsDetailsMarkup} from '../admin/habits-details.mjs';
import {youtubeReportMarkup} from '../admin/youtube-details.mjs';

test('restores distinct rolling seven-day Daily activity and the lifetime 3-in-7 cohort status',()=>{
 const markup=habitsDetailsMarkup({cohorts:[{
   source:'reddit',campaign:'launch',cohort_people:8,
   next_day_rate:50,next_day_returned:2,next_day_mature:4,next_day_immature:4,
   seven_day_rate:25,seven_day_returned:1,seven_day_mature:4,seven_day_immature:4,
   three_in_seven_rate:25,three_in_seven_reached:1,three_in_seven_mature:4,three_in_seven_immature:4,
   ever_three_in_seven_rate:37.5,ever_three_in_seven_people:3
 }],daily_health:[{day:'2026-11-19',people:9},{day:'2026-11-20',people:11}]});
 for(const term of ['Ever 3-in-7','37.5%','3 of 8 ever reached 3-in-7','4 still waiting','Rolling seven-day activity','2026-11-20','11','three different days'])
  assert.ok(markup.includes(term),term);
 assert.match(markup,/Within 7 days/);
});
test('habits details show empty results without claiming that a missing report is zero',()=>{
 const markup=habitsDetailsMarkup({cohorts:[],daily_health:[]});
 assert.match(markup,/No first-Daily cohorts/);
 assert.match(markup,/No rolling-week data/);
 assert.ok(!markup.includes('0%'));
});
test('habits details safely escape campaign names',()=>{
 const markup=habitsDetailsMarkup({cohorts:[{source:'reddit',campaign:'<img src=x>',cohort_people:1}]});
 assert.ok(!markup.includes('<img src=x>'));
 assert.match(markup,/&lt;img/);
});

test('YouTube detail keeps format, view seconds, debate retention checkpoints, shares and subscribers',()=>{
 const markup=youtubeReportMarkup({configured:true,generated_at:'2026-11-22T18:00:00Z',
  engaged_views_available:true,retention_points:['3s','9s','15s'],
  videos:[{published_at:'2026-11-22',title:'Which Would You Draft?',format:'debate',views:1000,engaged_views:620,
    average_view_seconds:13,average_view_pct:65,likes:40,shares:5,subscribers_gained:3,
    retention:{'3s':92.5,'9s':77.5,'15s':62.5}}]});
 for(const term of ['Debate Short','13s','92.5%','77.5%','62.5%','Subscribers gained','Shares','3','Full YouTube report','2026-11-22'])
  assert.ok(markup.includes(term),term);
});
test('YouTube fallback does not invent engaged views or retention for generic Shorts',()=>{
 const markup=youtubeReportMarkup({configured:true,engaged_views_available:false,retention_points:['3s'],
  videos:[{title:'Short <script>',format:'daily_generic',views:7,engaged_views:null,average_view_seconds:null,retention:null}]});
 assert.ok(markup.includes('Unavailable'));
 assert.ok(markup.includes('N/A'));
 assert.ok(!markup.includes('<script>'));
 assert.ok(markup.includes('&lt;script&gt;'));
});
test('YouTube disconnected and empty reports have clear states',()=>{
 assert.match(youtubeReportMarkup({configured:false}),/not connected/);
 assert.match(youtubeReportMarkup({configured:true,videos:[]}),/No Shorts/);
});
