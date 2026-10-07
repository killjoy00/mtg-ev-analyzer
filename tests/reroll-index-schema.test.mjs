import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRerollIndexSchema} from '../scripts/reroll-index-schema.mjs';

test('reroll release prerequisite accepts both SQL boolean encodings and rejects absent or invalid catalog results',async()=>{
  for(const value of [true,'t'])await verifyRerollIndexSchema(async()=>({rows:[{reroll_covering_index:value}]}));
  for(const rows of [[],[{}],[{reroll_covering_index:false}],[{reroll_covering_index:'f'}]])
    await assert.rejects(verifyRerollIndexSchema(async()=>({rows})),/migration 0056/);
});
