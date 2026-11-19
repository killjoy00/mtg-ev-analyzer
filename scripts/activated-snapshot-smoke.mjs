import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {gameDateKey} from '../game-date.mjs';
import {runActivatedSnapshotSmoke,runRecentActivationSmokes} from '../worker/activated-snapshot-smoke.mjs';
export * from '../worker/activated-snapshot-smoke.mjs';
const fail=message=>{throw Error('Activated snapshot smoke: '+message);};

async function main() {
 const args=process.argv.slice(2);
 const option=name=>{const i=args.indexOf(name);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--'))fail(name+' requires a value.');return args[i+1];};
 if(!args[0]||args[0].startsWith('--'))fail('Usage: node scripts/activated-snapshot-smoke.mjs CONNECTION_FILE --set SET_ID [--snapshot ID] [--day YYYY-MM-DD]');
 const {corpusDatabase}=await import('./neon-corpus-db.mjs');
 const day=option('--day')||gameDateKey();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('--day must be YYYY-MM-DD.');
 const recent=option('--recent');
 if(recent!==null) {
  if(option('--set')||option('--snapshot'))fail('Use --recent or --set, not both.');
  await runRecentActivationSmokes(corpusDatabase(args[0]),{hours:Number(recent),day});
  return;
 }
 await runActivatedSnapshotSmoke(corpusDatabase(args[0]),{setId:option('--set'),snapshotId:option('--snapshot'),day});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
