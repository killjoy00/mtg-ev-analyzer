import test from 'node:test';
import assert from 'node:assert/strict';
import {gameplayPuzzle,sameGameplayPuzzle} from '../scripts/corpus-puzzle-equivalence.mjs';

const puzzle={
  puzzle_id:'a'.repeat(32),
  set_id:'tst',
  historical_pick_id:'card-a',
  candidates:[
    {id:'card-a',name:'Alpha',model_probability:0.7,image_url:'https://old.example/a.jpg',mana_cost:'{1}{U}',rarity:'rare',type_line:'Creature'},
    {id:'card-b',name:'Beta',model_probability:0.3,image_url:'https://old.example/b.jpg'},
  ],
  prior_picks:[{id:'prior',name:'Prior',image_url:'https://old.example/p.jpg'}],
};

test('corpus gameplay equivalence ignores reviewed display metadata refreshes',()=>{
  const refreshed={
    ...puzzle,
    candidates:puzzle.candidates.map(card=>({...card,image_url:'https://new.example/'+card.id+'.jpg',mana_cost:'changed',rarity:'mythic',type_line:'Updated'})),
    prior_picks:puzzle.prior_picks.map(card=>({...card,image_url:'https://new.example/prior.jpg'})),
  };
  assert.equal(sameGameplayPuzzle(puzzle,refreshed),true);
  assert.deepEqual(gameplayPuzzle(puzzle),gameplayPuzzle(refreshed));
});

test('corpus gameplay equivalence still rejects gameplay drift',()=>{
  assert.equal(sameGameplayPuzzle(puzzle,{...puzzle,historical_pick_id:'card-b'}),false);
  assert.equal(sameGameplayPuzzle(puzzle,{
    ...puzzle,
    candidates:puzzle.candidates.map((card,index)=>index===0?{...card,model_probability:0.6}:card),
  }),false);
});
