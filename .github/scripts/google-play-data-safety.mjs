const sampleUrl='https://storage.googleapis.com/support-kms-prod/b5v9It2EgwrgyY1gPFVB3jPUypc5lL3oNg2G';
const packageName='pro.packone.app';
const mode=process.env.DATA_SAFETY_MODE?.trim();
const playToken=process.env.PLAY_ACCESS_TOKEN?.trim();
const admobEnabled=process.env.PACKONE_PLAY_DATA_SAFETY_ADMOB==='1';
// A public AdMob-enabled Android app must not be reverted to the historical
// ad-disabled Data safety declaration by a later accidental submit request.
if(mode==='submit'&&!admobEnabled)throw Error('Refusing to replace AdMob-enabled Google Play Data safety with the old ad-disabled declaration.');

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

function ensureRow(rows,{questionId,responseId='',value='',requirement='MAYBE_REQUIRED',label}){
  let row=rows.find(r=>r[COL_Q]===questionId&&r[COL_R]===responseId);
  if(!row){
    row={
      [COL_Q]:questionId,
      [COL_R]:responseId,
      [COL_V]:'',
      [COL_REQ]:requirement,
      [COL_LABEL]:label,
    };
    rows.push(row);
  }
  row[COL_V]=value;
  return row;
}
function ensureChoiceGroup(rows,questionId,choices,selectedIds){
  for(const choice of choices){
    ensureRow(rows,{
      questionId,
      responseId:choice.id,
      value:selectedIds.includes(choice.id)?'TRUE':'',
      requirement:'MULTIPLE_CHOICE',
      label:choice.label,
    });
  }
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

// Google's live applications.dataSafety validator requires the account-creation
// and account-deletion answers even though the current downloadable sample CSV
// omits these rows. Pack One supports email/password plus OAuth account creation
// (Google and Apple) and provides both in-app permanent deletion and a public
// web deletion resource.
ensureChoiceGroup(rows,'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS',[
  {id:'PSL_ACM_USER_ID_PASSWORD',label:'Which account creation methods does the app support? / Username and password'},
  {id:'PSL_ACM_USER_ID_OTHER_AUTH',label:'Which account creation methods does the app support? / Username and other authentication'},
  {id:'PSL_ACM_USER_ID_PASSWORD_OTHER_AUTH',label:'Which account creation methods does the app support? / Username, password, and other authentication'},
  {id:'PSL_ACM_OAUTH',label:'Which account creation methods does the app support? / OAuth'},
  {id:'PSL_ACM_OTHER',label:'Which account creation methods does the app support? / Other'},
  {id:'PSL_ACM_NONE',label:'Which account creation methods does the app support? / App does not allow account creation'},
],['PSL_ACM_USER_ID_PASSWORD','PSL_ACM_OAUTH']);
ensureRow(rows,{
  questionId:'PSL_ACCOUNT_DELETION_URL',
  value:'https://packone.pro/privacy/#delete-account',
  requirement:'MAYBE_REQUIRED',
  label:'Link where users can request deletion of their account and associated data',
});
ensureChoiceGroup(rows,'PSL_SUPPORT_DATA_DELETION_BY_USER',[
  {id:'DATA_DELETION_YES',label:'Can users request deletion of some or all data without deleting the account? / Yes'},
  {id:'DATA_DELETION_NO',label:'Can users request deletion of some or all data without deleting the account? / No'},
  {id:'DATA_DELETION_NO_AUTO_DELETED',label:'Can users request deletion of some or all data without deleting the account? / No, but data is automatically deleted within 90 days'},
],['DATA_DELETION_NO']);

const sdkPurposes=['PSL_ADVERTISING','PSL_ANALYTICS','PSL_FRAUD_PREVENTION_SECURITY'];
const specs=[
  {
    name:'Name',
    optional:true,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ACCOUNT_MANAGEMENT'],
  },
  {
    name:'Email address',
    optional:true,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ACCOUNT_MANAGEMENT','PSL_DEVELOPER_COMMUNICATIONS','PSL_ADVERTISING'],
  },
  {
    name:'Personal identifiers',
    optional:false,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ANALYTICS'],
  },
  {
    name:'Other actions',
    optional:false,
    purposes:['PSL_APP_FUNCTIONALITY','PSL_ANALYTICS'],
  },
  // Google Mobile Ads SDK collects and shares IP-derived approximate location,
  // app interactions, diagnostics and device/advertising IDs. The SDK does not
  // stop processing these solely because Pack One requests non-personalized ads.
  ...(admobEnabled?[
    'Approximate location','App interactions','Diagnostics','Device or other IDs',
  ].map(name=>({name,optional:false,shared:true,purposes:sdkPurposes})):[]),
];

const typeRows=rows.filter(r=>String(r[COL_Q]).includes('PSL_DATA_TYPES'));
for(const row of typeRows)row[COL_V]='';

const selected=[];
for(const spec of specs){
  const typeRow=findTypeRow(rows,spec.name);
  const token=typeRow[COL_R];
  typeRow[COL_V]='TRUE';

  const prefix=`PSL_DATA_USAGE_RESPONSES:${token}:`;
  // This is a multi-choice form: the AdMob SDK transfers data to Google, so
  // both "Collected" and "Shared" must be represented on SDK data types.
  const transfer=exactRows(rows,prefix+'PSL_DATA_USAGE_COLLECTION_AND_SHARING');
  for(const row of transfer)row[COL_V]=(
    row[COL_R]==='PSL_DATA_USAGE_ONLY_COLLECTED'
    ||(spec.shared&&row[COL_R]==='PSL_DATA_USAGE_ONLY_SHARED')
  )?'TRUE':'';
  if(!transfer.some(row=>row[COL_R]==='PSL_DATA_USAGE_ONLY_COLLECTED'))throw Error('Missing collected choice '+spec.name);
  if(spec.shared&&!transfer.some(row=>row[COL_R]==='PSL_DATA_USAGE_ONLY_SHARED'))throw Error('Missing shared choice '+spec.name);
  setBoolean(rows,prefix+'PSL_DATA_USAGE_EPHEMERAL',false);
  setChoice(
    rows,
    prefix+'DATA_USAGE_USER_CONTROL',
    spec.optional?'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL':'PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  );
  setPurposes(rows,prefix+'DATA_USAGE_COLLECTION_PURPOSE',spec.purposes);
  // Non-SDK data remains first-party/service-provider usage. The Google
  // Mobile Ads SDK explicitly documents third-party collection AND sharing.
  const sharing=rows.filter(r=>r[COL_Q]===prefix+'DATA_USAGE_SHARING_PURPOSE');
  if(spec.shared)setPurposes(rows,prefix+'DATA_USAGE_SHARING_PURPOSE',sdkPurposes);
  else for(const row of sharing)row[COL_V]='';

  selected.push({name:spec.name,token,optional:spec.optional,shared:Boolean(spec.shared),purposes:spec.purposes});
}

// Fail closed if the schema mapping selects anything unexpected.
const enabledTypes=typeRows.filter(r=>r[COL_V]==='TRUE').map(r=>({responseId:r[COL_R],label:normalizeLabel(r[COL_LABEL])}));
if(enabledTypes.length!==specs.length)throw Error(`Expected ${specs.length} enabled data types, found ${enabledTypes.length}: ${JSON.stringify(enabledTypes)}`);

// Results/news communications stay limited to the verified email. Advertising
// is also used by exactly the four declared Google Mobile Ads SDK data types.
const emailPurposeQuestion=`PSL_DATA_USAGE_RESPONSES:${selected.find(item=>item.name==='Email address').token}:DATA_USAGE_COLLECTION_PURPOSE`;
const developerCommunications=rows.filter(r=>r[COL_V]==='TRUE'&&r[COL_R]==='PSL_DEVELOPER_COMMUNICATIONS');
if(developerCommunications.length!==1||developerCommunications[0][COL_Q]!==emailPurposeQuestion)throw Error('Developer communications must be limited to Email address.');
const allowedAdvertisingQuestions=new Set([emailPurposeQuestion]);
for(const item of selected.filter(x=>x.shared)){
  const prefix=`PSL_DATA_USAGE_RESPONSES:${item.token}:`;
  allowedAdvertisingQuestions.add(prefix+'DATA_USAGE_COLLECTION_PURPOSE');
  allowedAdvertisingQuestions.add(prefix+'DATA_USAGE_SHARING_PURPOSE');
}
const advertising=rows.filter(r=>r[COL_V]==='TRUE'&&r[COL_R]==='PSL_ADVERTISING');
if(advertising.length!==allowedAdvertisingQuestions.size||advertising.some(r=>!allowedAdvertisingQuestions.has(r[COL_Q])))throw Error('Unexpected advertising purpose declarations.');
const allowedSharingQuestions=new Set(selected.filter(x=>x.shared).flatMap(item=>{
  const prefix=`PSL_DATA_USAGE_RESPONSES:${item.token}:`;
  return [prefix+'PSL_DATA_USAGE_COLLECTION_AND_SHARING',prefix+'DATA_USAGE_SHARING_PURPOSE'];
}));
const unexpectedShared=rows.filter(r=>r[COL_V]==='TRUE'&&(
  r[COL_R]==='PSL_DATA_USAGE_ONLY_SHARED'||String(r[COL_Q]).endsWith('DATA_USAGE_SHARING_PURPOSE')
)).filter(r=>!allowedSharingQuestions.has(r[COL_Q]));
if(unexpectedShared.length)throw Error(`Unexpected sharing declarations: ${JSON.stringify(unexpectedShared)}`);

const unresolvedRequired=rows.filter(r=>r[COL_REQ]==='REQUIRED'&&!String(r[COL_V]).trim());
if(unresolvedRequired.length)throw Error(`Unresolved REQUIRED rows: ${JSON.stringify(unresolvedRequired.slice(0,40))}`);

const accountMethods=rows.filter(r=>r[COL_Q]==='PSL_SUPPORTED_ACCOUNT_CREATION_METHODS'&&r[COL_V]==='TRUE').map(r=>r[COL_R]).sort();
if(JSON.stringify(accountMethods)!==JSON.stringify(['PSL_ACM_OAUTH','PSL_ACM_USER_ID_PASSWORD']))throw Error(`Unexpected account creation methods: ${JSON.stringify(accountMethods)}`);
const deletionUrl=rows.find(r=>r[COL_Q]==='PSL_ACCOUNT_DELETION_URL'&&r[COL_R]==='')?.[COL_V];
if(deletionUrl!=='https://packone.pro/privacy/#delete-account')throw Error(`Unexpected account deletion URL: ${deletionUrl}`);
const dataDeletion=rows.filter(r=>r[COL_Q]==='PSL_SUPPORT_DATA_DELETION_BY_USER'&&r[COL_V]==='TRUE').map(r=>r[COL_R]);
if(JSON.stringify(dataDeletion)!==JSON.stringify(['DATA_DELETION_NO']))throw Error(`Unexpected separate data-deletion answer: ${JSON.stringify(dataDeletion)}`);

// Validate every selected type has the complete conditional set we intend.
for(const item of selected){
  const prefix=`PSL_DATA_USAGE_RESPONSES:${item.token}:`;
  const collected=exactRows(rows,prefix+'PSL_DATA_USAGE_COLLECTION_AND_SHARING');
  if(!collected.some(r=>r[COL_R]==='PSL_DATA_USAGE_ONLY_COLLECTED'&&r[COL_V]==='TRUE'))throw Error(`${item.name}: collected not selected.`);
  const selectedShared=collected.some(r=>r[COL_R]==='PSL_DATA_USAGE_ONLY_SHARED'&&r[COL_V]==='TRUE');
  if(selectedShared!==item.shared)throw Error(`${item.name}: shared data declaration does not match SDK.`);
  const sharingPurposes=rows.filter(r=>r[COL_Q]===prefix+'DATA_USAGE_SHARING_PURPOSE'&&r[COL_V]==='TRUE').map(r=>r[COL_R]).sort();
  const expectedSharing=(item.shared?sdkPurposes:[]).slice().sort();
  if(JSON.stringify(sharingPurposes)!==JSON.stringify(expectedSharing))throw Error(`${item.name}: shared purposes mismatch.`);
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
  androidAdMobSdkDisclosed:admobEnabled,
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
