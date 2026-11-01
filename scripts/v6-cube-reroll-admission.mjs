// The v6 build applies the unchanged eight-source session admission to its own corpus.
import {pathToFileURL} from 'node:url';
import {admitCube} from './v5-cube-reroll-admission.mjs';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const report=admitCube('.','v6');
  console.log(JSON.stringify({schema:report.schema,input:report.input_decisions,retained:report.output_decisions,removed:report.removed_decisions,proof:report.proof}));
}
