const SPECS = Object.freeze({
  first:{label:'First Pack',tone:'career',glyph:'<rect x="11" y="8.5" width="10" height="15" rx="1.4"/><path d="M13.5 12h5M13.5 15h5"/><circle cx="16" cy="19.5" r="1.4"/>'},
  ten_games:{label:'Settling In',tone:'career',glyph:'<path d="M10 11.5h10v12H10zM13 8.5h9v12"/><path d="M12.5 15h5M12.5 18h5"/>'},
  fifty_games:{label:'Draft Regular',tone:'career',glyph:'<path d="M10 10v12M14 10v12M18 10v12M22 10v12M9 20l14-8"/>'},
  hundred_games:{label:'Century',tone:'career',glyph:'<path d="M12 22c-3-2.5-4.2-6.2-2.7-10M20 22c3-2.5 4.2-6.2 2.7-10"/><path d="M11 20l-2.8 1M10 16l-3-.4M10.5 12.5 8 11M21 20l2.8 1M22 16l3-.4M21.5 12.5 24 11"/><circle cx="16" cy="15.5" r="3.5"/>'},
  first_run:{label:'First Draft Run',tone:'run',glyph:'<path d="M9 21c2.5-7 4.5-9 8-7.2 2.8 1.4 3.5-.1 6-3.8"/><circle cx="9" cy="21" r="1.7"/><circle cx="17" cy="13.8" r="1.7"/><circle cx="23" cy="10" r="1.7"/>'},
  ten_runs:{label:'Ten Runs',tone:'run',glyph:'<path d="M10.2 12a7 7 0 0 1 11.8-1.8l2-1v5h-5l1.7-1.8"/><path d="M21.8 20a7 7 0 0 1-11.8 1.8l-2 1v-5h5l-1.7 1.8"/>'},
  run_specialist:{label:'Draft Run Specialist',tone:'mastery',glyph:'<circle cx="16" cy="16" r="7"/><circle cx="16" cy="16" r="3.2"/><circle cx="16" cy="16" r="1"/><path d="M21 11l3-3M21.5 8H24v2.5"/>'},
  set_specialist:{label:'Set Specialist',tone:'mastery',glyph:'<path d="M16 8.5l6 2v5.2c0 4-2.4 6.6-6 8.1-3.6-1.5-6-4.1-6-8.1v-5.2z"/><path d="m16 12 1.2 2.5 2.8.4-2 1.9.5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-1.9 2.8-.4z"/>'},
  perfect:{label:'Perfect 100',tone:'mastery',glyph:'<path d="M16 7.5l2.2 5.7 5.8.8-4.3 4.1 1.1 5.7-4.8-2.9-4.8 2.9 1.1-5.7L8 14l5.8-.8z"/><circle cx="16" cy="16" r="2"/>'},
  streak3:{label:'Three in a Row',tone:'streak',glyph:'<path d="M16 23c-4 0-6.5-2.4-6.5-5.8 0-2.8 1.8-4.3 3.7-6.9.2 2.4 1.6 3.3 2.4 3.8.1-3.1 1.8-5.1 3.3-6.4.2 3.3 3.6 5.3 3.6 9.5 0 3.4-2.5 5.8-6.5 5.8z"/><path d="M16 21c-1.6 0-2.6-1-2.6-2.3 0-1.2.8-2 2.4-3.7.1 1.3.7 2 1.3 2.5.2-1 .6-1.7 1.2-2.4.8 1.2 1.3 2.2 1.3 3.6 0 1.3-1 2.3-2.6 2.3z"/>'},
  streak7:{label:'One-Week Heater',tone:'streak',glyph:'<rect x="9" y="10" width="14" height="13" rx="1.5"/><path d="M9 14h14M12 8.5v3M20 8.5v3"/><path d="M13 18h1M16 18h1M19 18h1M13 21h1M16 21h1M19 21h1"/>'},
  streak30:{label:'Daily Ritual',tone:'streak',glyph:'<rect x="9" y="10" width="14" height="13" rx="1.5"/><path d="M9 14h14M12 8.5v3M20 8.5v3"/><circle cx="16" cy="18.5" r="2.4"/><path d="M16 15.1v-1.2M16 23.1v-1.2M12.6 18.5h-1.2M20.6 18.5h-1.2"/>'},
  explorer5:{label:'Archive Explorer',tone:'archive',glyph:'<circle cx="16" cy="16" r="7"/><path d="m19.5 12.5-2.1 4.9-4.9 2.1 2.1-4.9z"/>'},
  explorer10:{label:'Format Traveler',tone:'archive',glyph:'<path d="M10 21c3-2 3-8 6-8s3 5 6 3"/><circle cx="10" cy="21" r="1.8"/><circle cx="16" cy="13" r="1.8"/><circle cx="22" cy="16" r="1.8"/><path d="M9 10h5"/>'},
  explorer20:{label:'Deep Archive',tone:'archive',glyph:'<circle cx="16" cy="16" r="7"/><path d="M9 16h14M16 9c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7z"/>'},
  archive_complete:{label:'Archive Complete',tone:'archive',glyph:'<circle cx="16" cy="16" r="7"/><path d="M9 16h14M16 9c1.5 1.8 2.4 3.7 2.7 5.7"/><path d="m12.2 18.2 2.3 2.2 5.2-5.4"/>'},
  cube_first:{label:'Power Nine',tone:'cube',glyph:'<path d="m16 8.5 6 3.4v7.2L16 22.5l-6-3.4v-7.2z"/><path d="m10 11.9 6 3.4 6-3.4M16 15.3v7.2"/>'},
  cube_ten:{label:'Cube Regular',tone:'cube',glyph:'<path d="m13 8.5 5 2.8v5.8L13 20l-5-2.9v-5.8z"/><path d="m8 11.3 5 2.9 5-2.9M13 14.2V20"/><path d="m19 14 5 2.8v5.7L19 25l-4-2.3"/>'},
  challenge5:{label:'Five Up',tone:'challenge',glyph:'<path d="M14.5 12.2 12.7 10.4a3 3 0 0 0-4.2 4.2l3.1 3.1a3 3 0 0 0 4.2 0l1.4-1.4"/><path d="m17.5 19.8 1.8 1.8a3 3 0 0 0 4.2-4.2l-3.1-3.1a3 3 0 0 0-4.2 0l-1.4 1.4"/>'},
  challenge25:{label:'Table Captain',tone:'challenge',glyph:'<path d="M11 22V9l11 3.2-11 3.2"/><path d="M9 23h7"/><circle cx="20.5" cy="20.5" r="2.5"/><path d="m19.4 20.5.8.8 1.6-1.8"/>'},
  top25:{label:'Top Quarter',tone:'rank',glyph:'<path d="M9 22h5v-6H9zM14 22h5V11h-5zM19 22h5v-3h-5z"/><path d="m16.5 8 1 2 2.2.3-1.6 1.5"/>'},
  top10:{label:'Top Ten Percent',tone:'rank',glyph:'<circle cx="16" cy="13.5" r="4.5"/><path d="m13.5 17.2-1 6 3.5-2 3.5 2-1-6"/><path d="m16 10.8.8 1.5 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z"/>'},
  top10_repeat:{label:'Repeat Contender',tone:'rank',glyph:'<path d="m10 11 3 3 3-3M16 11l3 3 3-3"/><path d="M10 18h12M12 21h8"/><circle cx="16" cy="9" r="1.2"/>'},
  top1:{label:'One Percent',tone:'rank',glyph:'<path d="m9 20-1-9 5 4 3-7 3 7 5-4-1 9z"/><path d="M10 23h12M12 20v-3M20 20v-3"/>'},
});

const FRAME='<path class="achievement-mark-frame" d="M16 2.7 27 8.9v14.2L16 29.3 5 23.1V8.9Z"/>';

export const achievementIconIds=Object.freeze(Object.keys(SPECS));

export function achievementIconSpec(id) {
  return SPECS[String(id||'')]||null;
}

export function achievementMark(id,{decorative=false,locked=false,compact=false}={}) {
  const spec=achievementIconSpec(id);
  if(!spec)return '';
  const classes=['achievement-mark','achievement-mark--'+spec.tone];
  if(locked)classes.push('is-locked');
  if(compact)classes.push('compact');
  const access=decorative
    ? 'aria-hidden="true"'
    : 'role="img" aria-label="'+spec.label.replace(/"/g,'&quot;')+' achievement"';
  return '<span class="'+classes.join(' ')+'" data-achievement-mark="'+id+'" title="'+spec.label.replace(/"/g,'&quot;')+'" '+access+'><svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">'+FRAME+'<g class="achievement-mark-glyph">'+spec.glyph+'</g></svg></span>';
}
