import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGradleDependencies} from '../scripts/prepare-gradle-dependencies.mjs';
const failure="Could not GET 'https://repo.maven.apache.org/compiler.jar'. Received status code 500 from server";
const response=(status,stderr='')=>({status,stdout:'',stderr});
test('Gradle configuration retries an upstream 500 once, then preserves successful preparation',async()=>{
  let calls=0;
  const attempts=await prepareGradleDependencies({run:(command,args)=>{assert.equal(command,'./gradlew');assert.equal(args[0],'help');calls++;return calls===1?response(1,failure):response(0);},sleep:async()=>{},emit:()=>{}});
  assert.equal(attempts.length,2);assert.equal(calls,2);
});
test('compiler and test errors are not retried even alongside an HTTP error',async()=>{
  for(const message of ['e: /app/Main.kt: type mismatch','SyntaxError: Unexpected token','3 tests failed']) {
    let calls=0;
    await assert.rejects(prepareGradleDependencies({run:()=>{calls++;return response(1,failure+'\n'+message);},emit:()=>{}}),/preparation failed/);
    assert.equal(calls,1);
  }
});
test('permanent dependency failures do not retry',async()=>{
  let calls=0;
  await assert.rejects(prepareGradleDependencies({run:()=>{calls++;return response(1,failure.replace('500','404'));},emit:()=>{}}),/preparation failed/);
  assert.equal(calls,1);
});
test('persistent upstream failures stop after two attempts',async()=>{
  let calls=0;
  await assert.rejects(prepareGradleDependencies({run:()=>{calls++;return response(1,failure);},sleep:async()=>{},emit:()=>{}}),/preparation failed/);
  assert.equal(calls,2);
});
