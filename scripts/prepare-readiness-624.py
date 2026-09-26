from pathlib import Path

def edit(path, old, new, count=1):
    p=Path(path); text=p.read_text()
    assert text.count(old)==count, (path, text.count(old), old[:100])
    p.write_text(text.replace(old,new))

edit('worker/draft-run-selection.mjs', 'export async function loadServingSnapshot(query,version) {', 'export async function loadServingSnapshot(query,version,{readiness=false}={}) {')
edit('worker/draft-run-selection.mjs', "query('SELECT pack1_serving_snapshot($1,$2,$3) snapshot',", "query(readiness?'SELECT pack1_build_serving_snapshot($1,$2,$3) snapshot':'SELECT pack1_serving_snapshot($1,$2,$3) snapshot',")
p=Path('worker/draft-run-selection.mjs'); s=p.read_text(); start=s.index('export async function selectCachedDatabaseRun(')
s=s[:start]+s[start:].replace('await loadServingSnapshot(query,version);','await loadServingSnapshot(query,version,{readiness:options.readiness===true});'); p.write_text(s)

p=Path('scripts/activated-snapshot-smoke.mjs'); s=p.read_text()
s=s.replace('selectCachedDatabaseRun,selectDatabaseRun,selectDatabaseReroll,toPgArray','selectCachedDatabaseRun,selectDatabaseRun,selectDatabaseReroll,servingRevisionMatches,toPgArray')
s=s.replace('log=console.log}={}) {\n if(!setId)', 'log=console.log,readiness=false,expectedRevision=null}={}) {\n if(!setId)')
s=s.replace('const cache=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);', "const cache=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION,{readiness});\n if(expectedRevision!==null)assert.equal(String(cache.revision),String(expectedRevision),'Smoke loaded a different serving revision');")
s=s.replace('const eligible=customSetsFromSnapshot(cache,day,[setId]).some(s=>s.set_id===setId);', "const cube=setId==='powered-cube',environment=cube?'powered-cube':'mixed';\n const eligible=cube||customSetsFromSnapshot(cache,day,[setId]).some(s=>s.set_id===setId);")
s=s.replace("seed,'mixed',{setIds:[setId],day}","seed,environment,{setIds:cube?[]:[setId],day,readiness}")
s=s.replace("runPickWindows('mixed').map(w=>w[0])",'runPickWindows(environment).map(w=>w[0])')
s=s.replace("type:'pack',round:i,seed,environment:'mixed',setIds:[setId],excludedSources,", "type:'pack',round:i,seed,environment,setIds:cube?[]:[setId],excludedSources,")
s=s.replace('  let snapshots=await puzzleSnapshots(query,practice.map(p=>p.puzzle_id));', "  assert.equal(String(practice.servingRevision),String(cache.revision),'Practice smoke changed serving revision');\n  let snapshots=await puzzleSnapshots(query,practice.map(p=>p.puzzle_id));")
s=s.replace(" log(JSON.stringify({smoke:'activated_snapshot',pass:true,...result}));", " await loadActivatedEnvironment(query,setId,env.active_snapshot_id);\n assert.ok(await servingRevisionMatches(query,cache.revision),'Serving revision changed during the activation smoke');\n log(JSON.stringify({smoke:'activated_snapshot',pass:true,...result}));")
s=s.replace("WHERE e.component_version IS NULL AND e.new_status='Live'", "WHERE e.new_status='Live'")
p.write_text(s)

p=Path('worker/corpus-admin.mjs'); s=p.read_text()
s="import {registerServingReadiness,readServingReadiness,advanceServingReadiness,retryServingReadiness,readinessKey} from './corpus-readiness.mjs';\n"+s
s=s.replace('export async function handleCorpusAdmin(', 'async function handleCorpusLifecycle(')
assert s.count('SELECT changed.* FROM changed CROSS JOIN audit')==2
s=s.replace('SELECT changed.* FROM changed CROSS JOIN audit','SELECT changed.*,audit.id::text activation_event_id FROM changed CROSS JOIN audit')
s=s.replace('SELECT c.* FROM changed c CROSS JOIN promoted CROSS JOIN audit','SELECT c.*,audit.id::text activation_event_id FROM changed c CROSS JOIN promoted CROSS JOIN audit')
start=s.index(' const snapshotMatch='); end=s.index(' const match=path.match',start)
block=s[start:end]
block=block.replace("WHERE p.set_id=$1 AND p.status='Live' AND EXISTS(SELECT 1 FROM identity_allowed)","WHERE p.set_id=$1 AND p.status='Live' AND EXISTS(SELECT 1 FROM identity_allowed)\n    AND ($8::text IS NULL OR p.active_snapshot_id=$8) FOR UPDATE OF p")
block=block.replace('automationIdentity?JSON.stringify(automationIdentity):null]);','automationIdentity?JSON.stringify(automationIdentity):null,b.expectedActiveSnapshotId||null]);')
s=s[:start]+block+s[end:]
s+='''\n\n// Lifecycle admission is unchanged. Only a committed audit event may hand off\n// to readiness, and the event's revision is assigned by the transactional outbox.\nexport async function handleCorpusAdmin(request,query,readJson,accountId,automationIdentity=null) {\n const url=new URL(request.url),path=url.pathname;\n if(request.method==='GET'&&path==='/v1/admin/corpus/readiness') {\n  const operationId=url.searchParams.get('operation');\n  if(operationId&&!/^[1-9][0-9]{0,18}$/.test(operationId))fail('Invalid readiness operation.');\n  return readServingReadiness(query,{operationId});\n }\n const retry=path.match(/^\\/v1\\/admin\\/corpus\\/readiness\\/([1-9][0-9]{0,18})\\/retry$/);\n if(request.method==='POST'&&retry) {\n  if(!accountId&&!automationIdentity)fail('Authenticated administrative identity required.',403);\n  await readJson(request);\n  const readiness=await retryServingReadiness(query,retry[1],automationIdentity||{account_id:accountId});\n  return {ok:readiness.ready,publication_unchanged:true,readiness};\n }\n if(request.method==='GET') {\n  const data=await handleCorpusLifecycle(request,query,readJson,accountId,automationIdentity);\n  const readiness=await readServingReadiness(query).catch(()=>({state:'unavailable',ready:false}));\n  return {...data,readiness};\n }\n if(!accountId&&!automationIdentity)fail('Authenticated administrative identity required.',403);\n let registered=false;\n const guardedQuery=async(sql,params)=>{\n  if(!registered){await registerServingReadiness(query);registered=true;}\n  return query(sql,params);\n };\n const result=await handleCorpusLifecycle(request,guardedQuery,readJson,accountId,automationIdentity);\n // Never turn an error after commit into a claim that activation was rolled back.\n let readiness;\n try {\n  const job=(await query(`SELECT j.id::text id FROM corpus_status_events e\n   JOIN draft_run_readiness_jobs j ON j.revision=e.readiness_revision\n   JOIN draft_run_readiness_keys k ON k.id=j.key_id\n   WHERE e.id=$1::bigint AND k.corpus_version=$2 AND k.difficulty_version=$3\n    AND k.serving_policy_version=$4 AND k.cache_schema=$5`,[result.activation_event_id,...readinessKey])).rows[0];\n  if(!job)throw Error('Committed readiness operation was not found');\n  readiness=await advanceServingReadiness(query,{operationId:job.id});\n } catch {\n  readiness={state:'unavailable',ready:false,message:'Activation committed. Readiness could not be confirmed; inspect its audit event and retry readiness, not activation.'};\n }\n return {...result,ok:readiness.ready===true,activation_committed:true,readiness};\n}\n'''
p.write_text(s)

edit('worker/growth-function.js', "import {inspectLaunchCoverageFreshness} from './launch-watcher-stale.mjs';", "import {inspectLaunchCoverageFreshness} from './launch-watcher-stale.mjs';\nimport {maintainServingReadiness} from './corpus-readiness.mjs';")
edit('worker/growth-function.js', '    freshness=await inspectLaunchCoverageFreshness({now:Date.parse(trigger.scheduledAt)});', "    const readiness=await maintainServingReadiness(query);\n    console.log(JSON.stringify({operation:'corpus-readiness-maintenance',operation_id:readiness.operation_id,state:readiness.state,revision:readiness.current_revision,ready:readiness.ready}));\n    freshness=await inspectLaunchCoverageFreshness({now:Date.parse(trigger.scheduledAt)});")

p=Path('admin/corpus.mjs'); s=p.read_text()
s="import {readinessMarkup,readinessMessage,observeReadiness} from './corpus-readiness.mjs';\n"+s
s=s.replace('<p id="corpus-status" role="status"></p>', '<p id="corpus-status" role="status"></p><section id="corpus-readiness" aria-label="Serving readiness">${readinessMarkup(data.readiness)}</section>')
start=s.index(' dialog.onsubmit=async e=>')
s=s[:start]+''' dialog.onsubmit=async e=>{\n  const form=e.target.closest('[data-status-form],[data-snapshot-form]');if(!form)return;e.preventDefault();\n  const component=form.dataset.component,s=component?data.components.find(c=>c.set_id===form.dataset.set&&c.component_version===component):sets.find(s=>s.set_id===form.dataset.set);\n  const b=Object.fromEntries(new FormData(form)),snapshot=form.matches('[data-snapshot-form]');\n  if(snapshot?!b.sourceSnapshotId:!b.status)return;\n  form.querySelector('button').disabled=true;\n  let message=dialog.querySelector('.corpus-action-error');\n  if(!message){message=document.createElement('p');message.className='corpus-action-error';message.setAttribute('role','status');form.after(message);}\n  message.textContent='Applying the change, then warming and verifying the current serving revision. Publication and readiness are separate steps.';\n  const stop=observeReadiness(root,request,{afterRevision:data.serving_revision});\n  try {\n   const result=snapshot?await request(`/v1/admin/corpus/${s.set_id}/snapshot`,{...b,corpusVersion:data.corpus_version,expectedActiveSnapshotId:s.active_snapshot_id}):\n    await request(`/v1/admin/corpus/${s.set_id}${component?`/components/${component}`:''}/status`,{...b,oldStatus:s.status,corpusVersion:data.corpus_version});\n   dialog.close();await renderCorpus(root,request);\n   root.querySelector('#corpus-status').textContent=`${s.set_id}: ${readinessMessage(result.readiness)}`;\n  } catch(cause) {\n   message.className='error corpus-action-error';message.setAttribute('role','alert');\n   message.textContent=`${cause.message} Check readiness and status history before repeating activation; a lost response does not prove rollback.`;\n   form.querySelector('button').disabled=false;\n  } finally {stop();}\n };draw();observeReadiness(root,request);\n}\n'''
p.write_text(s)

# The old reporting fixture deliberately has only P1 rows: inspect the builder\n# primitive there, while the new readiness suite tests full admission/readiness.\nedit('tests/corpus-admin-backend-smoke.mjs','SELECT pack1_serving_snapshot($1,','SELECT pack1_build_serving_snapshot($1,')
p=Path('tests/corpus-admin-backend-smoke.mjs'); p.write_text(p.read_text()+"\n// The separate readiness suite registers its own full-coverage acceptance key.\nawait query('DELETE FROM draft_run_readiness_keys');\n")

p=Path('.github/workflows/backend-gate.yml'); s=p.read_text()
s=s.replace('migrations/0042_serving_revision_snapshot_staging.sql)', 'migrations/0042_serving_revision_snapshot_staging.sql migrations/0043_corpus_activation_readiness.sql)')
s=s.replace('          node tests/season-backend-smoke.mjs "$PACK1_CI_CONNECTION" --production-bootstrap', '          # Legacy primitive fixtures bypass readiness; the dedicated suite below enables and proves the production gate.\n          psql "$(cat "$PACK1_CI_CONNECTION")" -v ON_ERROR_STOP=1 -c "DELETE FROM draft_run_readiness_keys"\n          node tests/season-backend-smoke.mjs "$PACK1_CI_CONNECTION" --production-bootstrap')
s=s.replace('          # Destructive season edge cases', '          node tests/corpus-readiness-backend-smoke.mjs "$PACK1_CI_CONNECTION" --dev-fixtures\n          # Destructive season edge cases')
p.write_text(s)

p=Path('.github/workflows/secure-auth-release.yml'); s=p.read_text()
old='          psql "$connection" -v ON_ERROR_STOP=1 -f migrations/0042_serving_revision_snapshot_staging.sql'
assert s.count(old)==2
s=s.replace(old,old+'\n          psql "$connection" -v ON_ERROR_STOP=1 -f migrations/0043_corpus_activation_readiness.sql')
s+='''\n      - uses: actions/upload-artifact@v4\n        if: always()\n        with:\n          name: corpus-readiness-${{ github.run_id }}\n          path: artifacts/corpus-readiness\n          if-no-files-found: error\n          retention-days: 30\n'''
p.write_text(s)

p=Path('.github/workflows/corpus-activation-smoke.yml'); s=p.read_text()
s=s.replace('            echo "Checking $target"','            echo "Checking $target"\n            DATABASE_URL="$connection" node scripts/warm-practice-cache.mjs')
p.write_text(s)

p=Path('scripts/publish-puzzle-components.mjs'); s=p.read_text()
old=' console.log(JSON.stringify(result));live.push(s);'
assert old in s
s=s.replace(old," console.log(JSON.stringify(result));\n if(!result.ok)throw Error('Publication committed but readiness did not complete: '+JSON.stringify(result.readiness));\n live.push(s);")
p.write_text(s)

# Close the check-then-build race: registered keys return the already verified\n# cache directly. They NEVER call a builder, even if a publication races the read.\np=Path('migrations/0043_corpus_activation_readiness.sql'); s=p.read_text()
s=s.replace('DECLARE k bigint; rev bigint;', 'DECLARE k bigint; rev bigint; snapshot draft_run_serving_snapshots%ROWTYPE;')
a=s.index('  IF NOT EXISTS(SELECT 1 FROM draft_run_readiness_jobs j JOIN draft_run_serving_snapshots s ON s.id=j.cache_snapshot_id')
b=s.index('\n END IF;\n RETURN pack1_build_serving_snapshot',a)
s=s[:a]+'''  SELECT s.* INTO snapshot FROM draft_run_readiness_jobs j JOIN draft_run_serving_snapshots s ON s.id=j.cache_snapshot_id\n   WHERE j.key_id=k AND j.revision=rev AND j.state='ready' AND s.revision=rev\n    AND s.corpus_version=p_parent_version AND s.difficulty_version=p_difficulty\n    AND s.serving_policy_version=p_policy_version AND s.cache_schema='serving-cache-v1';\n  IF NOT FOUND THEN RETURN NULL; END IF;\n  RETURN jsonb_build_object('id',snapshot.id::text,'revision',snapshot.revision::text,'metadata',snapshot.metadata,'groups',snapshot.groups);'''+s[b:]
p.write_text(s)

print('Applied guarded readiness integration edits.')
