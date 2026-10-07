import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function retryableDependencyFailure(output) {
  return /Could not (?:GET|HEAD) 'https:\/\/[^']+'\. Received status code (?:429|500|502|503|504)\b/.test(output)
    && !/(?:^|\n)(?:e: |.*Compilation error|.*tests? failed|.*SyntaxError|.*FAIL:)/im.test(output);
}
export async function prepareGradleDependencies({run=spawnSync,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),emit=text=>process.stdout.write(text)}={}) {
  const attempts=[];
  for(let attempt=1;attempt<=2;attempt++) {
    const started=Date.now();
    // Only configure/resolve plugins here. App compilation and acceptance run
    // later, exactly once; their failures never enter this retry path.
    const result=run('./gradlew',['help','--no-daemon','--build-cache'],{encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});
    const output=(result.stdout||'')+(result.stderr||'');emit(output);
    attempts.push({attempt,exit_code:result.status,signal:result.signal||null,duration_ms:Date.now()-started});
    if(result.status===0)return attempts;
    if(result.error||!retryableDependencyFailure(output)||attempt===2)throw Object.assign(Error('Gradle dependency preparation failed; app build was not started'),{attempts});
    emit('\nTransient dependency HTTP failure: retrying Gradle configuration once.\n');
    await sleep(2000);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../artifacts/native-build');
  fs.mkdirSync(root,{recursive:true});let report;
  try {report={phase:'gradle_dependencies',status:'passed',attempts:await prepareGradleDependencies({emit:output=>{process.stdout.write(output);fs.appendFileSync(path.join(root,'gradle-dependencies.log'),output);}})};}
  catch(error){report={phase:'gradle_dependencies',status:'failed',attempts:error.attempts||[]};throw error;}
  finally {fs.writeFileSync(path.join(root,'gradle-dependencies.json'),JSON.stringify(report,null,2)+'\n');}
}
