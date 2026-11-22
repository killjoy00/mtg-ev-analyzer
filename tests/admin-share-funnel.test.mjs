import test from 'node:test';
import assert from 'node:assert/strict';
import {shareFunnelMarkup} from '../admin/share-funnel-view.mjs';
test('preserves the full existing result-share funnel rather than just the two Overview figures',()=>{
 const html=shareFunnelMarkup({share_funnel:{finishers:50,sharers:10,share_pct:20,arrivals:18,visitors:14,
   starts:9,completions:6,dated_arrivals:4,start_pct:50,completion_pct:66.7,image_shares:3}});
 for(const text of ['50','20.0%','18','14','9','6','4','66.7%','Image shares','native app shares','not all visits'])
   assert.ok(html.includes(text),text);
});
test('unavailable sharing metrics are not reported as zero',()=>{
 assert.match(shareFunnelMarkup({}),/unavailable/);
 assert.match(shareFunnelMarkup({share_funnel:{arrivals:0}}),/0/);
 assert.match(shareFunnelMarkup({share_funnel:{arrivals:0}}),/Unavailable/);
});
