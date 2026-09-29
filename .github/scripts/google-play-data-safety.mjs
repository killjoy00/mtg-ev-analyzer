const sampleUrl='https://storage.googleapis.com/support-kms-prod/b5v9It2EgwrgyY1gPFVB3jPUypc5lL3oNg2G';
const packageName='pro.packone.app';
const mode=process.env.DATA_SAFETY_MODE?.trim();
const playToken=process.env.PLAY_ACCESS_TOKEN?.trim();

if(!['dry-run','submit'].includes(mode))throw Error('DATA_SAFETY_MODE must be dry-run or submit.');
if(mode==='submit'&&!playToken)throw Error('PLAY_ACCESS_TOKEN is required for submit mode.');

const COL_Q='Question ID (machine readable)';
const COL_R='Response ID (machine readable)';
const COL_V='Response value';
const COL_REQ='Answer requirement';
const COL_LABEL='Human-friendly question label';

function parseCsv(text){
  const rows=[]; let row=[]; let cell=''; let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===','){row.push(cell);cell='';}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
      else cell+=ch;
    }
  }
  if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  const header=rows.shift();
  return {header,rows:rows.filter(r=>r.some(x=>x!=='' )).map(values=>Object.fromEntries(header.map((h,i)=>[h,values[i]??''])))};
}
function csvCell(value){
  const s=String(value??'');
  return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
}
function serializeCsv(header,rows){
  return [header.join(','),...rows.map(r=>header.map(h=>csvCell(r[h])).join(','))].join('\r\n')+'\r\n';
}
function normalizeLabel(value){return String(value||'').replace(/\r/g,'').trim();}
function setSingleton(rows,qid,value){
  const matches=rows.filter(r=>r[COL_Q]===qid&&r[COL_R]==='');
  if(matches.length!==1)throw Error(`Expected one ${qid} singleton row, found ${matches.length}.`);
  matches[0][COL_V]=value;
}
function findTypeRow(rows,humanName){
  const matches=rows.filter(r=>{
    if(!String(r[COL_Q]).includes('PSL_DATA_TYPES'))return false;
    const parts=normalizeLabel(r[COL_LABEL]).split('\n').map(x=>x.trim()).filter(Boolean);
    return parts.at(-1)===humanName;
  });
  if(matches.length!==1){
    const candidates=rows.filter(r=>String(r[COL_Q]).includes('PSL_DATA_TYPES')).map(r=>({q:r[COL_Q],r:r[COL_R],label:r[COL_LABEL]}));
    throw Error(`Expected one data-type row for ${humanName}; found ${matches.length}. Candidates: ${JSON.stringify(candidates.slice(0,100))}`);
  }
  if(!matches[0][COL_R])throw Error(`Data type ${humanName} has no machine response ID.`);
  return matches[0];
}
function exactRows(rows,qid){
  const out=rows.filter(r=>r[COL_Q]===qid);
  if(!out.length)throw Error(`No rows found for ${qid}.`);
  return out;
}
function setChoice(rows,qid,responseId){
  const choices=exactRows(rows,qid);
  const match=choices.find(r=>r[COL_R]===responseId);
  if(!match)throw Error(`Missing response ${responseId} for ${qid}.`);
  for(const r of choices)r[COL_V]=r===match?'TRUE':'';
}
function setBoolean(rows,qid,value){
  const choices=exactRows(rows,qid);
  if(choices.length!==1||choices[0][COL_R]!=='')throw Error(`Expected one boolean row for ${qid}.`);
  choices[0][COL_V]=value?'TRUE':'FALSE';
}
function setPurposes(rows,qid,purposes){
  const choices=exactRows(rows,qid);
  const known=new Set(choices.map(r=>r[COL_R]));
  for(const purpose of purposes)if(!known.has(purpose))throw Error(`Missing purpose ${purpose} for ${qid}.`);
  for(const r of choices)r[COL_V]=purposes.includes(r[COL_R])?'TRUE':'';
}

const response=await fetch(sampleUrl);
if(!response.ok)throw Error(`Google sample CSV HTTP ${response.status}`);
const raw=await response.text();
const {header,rows}=parseCsv(raw);
for(const required of [COL_Q,COL_R,COL_V,COL_REQ,COL_LABEL])if(!header.includes(required))throw Error(`Missing CSV column: ${required}`);

// Google ships example answers in the sample. Clear every answer before applying Pack One's declaration.
for(const row of rows)row[COL_V]='';

setSingleton(rows,'PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA','TRUE');
setSingleton(rows,'PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT','TRUE');
setSingleton(rows,'PSL_DATA_COLLECTION_USER_REQUEST_DELETE','TRUE');

const specs=[
  {
    name:'Name',
    optional:true,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ACCOUNT_MANAGEMENT'],
  },
  {
    name:'Email address',
    optional:true,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_DEVELOPER_COMMUNICATIONS','PSL_ACCOUNT_MANAGEMENT'],
  },
  {
    name:'User IDs',
    optional:false,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ANALYTICS','PSL_FRAUD_PREVENTION_SECURITY','PSL_ACCOUNT_MANAGEMENT'],
  },
  {
    name:'App interactions',
    optional:false,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ANALYTICS'],
  },
  {
    name:'Other actions',
    optional:false,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ANALYTICS'],
  },
];

const typeRows=rows.filter(r=>String(r[COL_Q]).includes('PSL_DATA_TYPES'));
for(const row of typeRows)row[COL_V]='';

const selected=[];
for(const spec of specs){
  const typeRow=findTypeRow(rows,spec.name);
  const token=typeRow[COL_R];
  typeRow[COL_V]='TRUE';

  const prefix=`PSL_DATA_USAGE_RESPONSES:${token}:`;
  setChoice(rows,prefix+'PSL_DATA_USAGE_COLLECTION_AND_SHARING','PSL_DATA_USAGE_ONLY_COLLECTED');
  setBoolean(rows,prefix+'PSL_DATA_USAGE_EPHEMERAL',false);
  setChoice(
    rows,
    prefix+'DATA_USAGE_USER_CONTROL',
    spec.optional?'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL':'PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  );
  setPurposes(rows,prefix+'DATA_USAGE_COLLECTION_PURPOSE',spec.purposes);
  // Nothing is declared shared. Service providers and user-initiated provider flows are handled under Google's sharing exclusions.
  const sharing=rows.filter(r=>r[COL_Q]===prefix+'DATA_USAGE_SHARING_PURPOSE');
  for(const row of sharing)row[COL_V]='';

  selected.push({name:spec.name,token,optional:spec.optional,purposes:spec.purposes});
}

// Fail closed if the schema mapping selects anything unexpected.
const enabledTypes=typeRows.filter(r=>r[COL_V]==='TRUE').map(r=>({responseId:r[COL_R],label:normalizeLabel(r[COL_LABEL])}));
if(enabledTypes.length!==specs.length)throw Error(`Expected ${specs.length} enabled data types, found ${enabledTypes.length}: ${JSON.stringify(enabledTypes)}`);

const sharedRows=rows.filter(r=>r[COL_V]==='TRUE'&&(r[COL_R]==='PSL_DATA_USAGE_ONLY_SHARED'||String(r[COL_Q]).endsWith('DATA_USAGE_SHARING_PURPOSE')));
if(sharedRows.length)throw Error(`Unexpected sharing declarations: ${JSON.stringify(sharedRows)}`);

const advertisingRows=rows.filter(r=>r[COL_V]==='TRUE'&&r[COL_R]==='PSL_ADVERTISING');
if(advertisingRows.length)throw Error('Advertising/marketing purpose must not be selected.');

const unresolvedRequired=rows.filter(r=>r[COL_REQ]==='REQUIRED'&&!String(r[COL_V]).trim());
if(unresolvedRequired.length)throw Error(`Unresolved REQUIRED rows: ${JSON.stringify(unresolvedRequired.slice(0,40))}`);

// Validate every selected type has the complete conditional set we intend.
for(const item of selected){
  const prefix=`PSL_DATA_USAGE_RESPONSES:${item.token}:`;
  const collected=exactRows(rows,prefix+'PSL_DATA_USAGE_COLLECTION_AND_SHARING');
  if(!collected.some(r=>r[COL_R]==='PSL_DATA_USAGE_ONLY_COLLECTED'&&r[COL_V]==='TRUE'))throw Error(`${item.name}: collected not selected.`);
  if(collected.some(r=>r[COL_R]==='PSL_DATA_USAGE_ONLY_SHARED'&&r[COL_V]==='TRUE'))throw Error(`${item.name}: shared unexpectedly selected.`);
  const ephemeral=exactRows(rows,prefix+'PSL_DATA_USAGE_EPHEMERAL');
  if(ephemeral.length!==1||ephemeral[0][COL_V]!=='FALSE')throw Error(`${item.name}: ephemeral must be FALSE.`);
  const control=exactRows(rows,prefix+'DATA_USAGE_USER_CONTROL').filter(r=>r[COL_V]==='TRUE');
  if(control.length!==1)throw Error(`${item.name}: expected exactly one user-control answer.`);
  const purposes=exactRows(rows,prefix+'DATA_USAGE_COLLECTION_PURPOSE').filter(r=>r[COL_V]==='TRUE').map(r=>r[COL_R]).sort();
  const expected=[...item.purposes].sort();
  if(JSON.stringify(purposes)!==JSON.stringify(expected))throw Error(`${item.name}: purpose mismatch ${JSON.stringify({purposes,expected})}`);
}

const csv=serializeCsv(header,rows);
await import('node:fs').then(fs=>fs.writeFileSync('pack-one-data-safety.csv',csv));

const trueRows=rows.filter(r=>r[COL_V]==='TRUE');
const falseRows=rows.filter(r=>r[COL_V]==='FALSE');
const maybeBlank=rows.filter(r=>r[COL_REQ]==='MAYBE_REQUIRED'&&!String(r[COL_V]).trim());

console.log(JSON.stringify({
  mode,
  sampleRows:rows.length,
  selected,
  enabledTypes,
  trueResponses:trueRows.length,
  falseResponses:falseRows.length,
  unresolvedRequired:unresolvedRequired.length,
  maybeRequiredBlankCount:maybeBlank.length,
  maybeRequiredBlankExamples:maybeBlank.slice(0,20).map(r=>({q:r[COL_Q],r:r[COL_R],label:normalizeLabel(r[COL_LABEL])})),
  safetyLabelsBytes:Buffer.byteLength(csv),
},null,2));

if(mode==='submit'){
  const api=`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/dataSafety`;
  const post=await fetch(api,{
    method:'POST',
    headers:{Authorization:`Bearer ${playToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({safetyLabels:csv}),
  });
  const text=await post.text();
  if(!post.ok)throw Error(`Google Data Safety POST HTTP ${post.status}: ${text}`);
  console.log('Google Play Data Safety declaration submitted successfully.');
}else{
  console.log('Dry run only: Google Play Data Safety was not submitted.');
}
