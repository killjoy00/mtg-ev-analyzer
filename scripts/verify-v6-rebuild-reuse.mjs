import {pathToFileURL} from 'node:url';
import {main} from './verify-v5-rebuild-reuse.mjs';

// The v6 rebuild reuses the reviewed v5 provenance checks with its own plan.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv[2]||'','v6');
