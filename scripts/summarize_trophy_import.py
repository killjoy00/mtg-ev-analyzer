"""Readable Actions summary; counts never hide incomplete archives."""
import json,os,sys
from pathlib import Path
root=Path(sys.argv[1]);p=root/'catalog.json'
if not p.exists():text='Import did not produce a final catalog. Inspect the failed step and any saved checkpoints.\n'
else:
 c=json.loads(p.read_text());text=f"# Premier trophy import\n\nArchive processing complete: {c['complete']}\n\nDeployment success is shown by the development and production workflow steps.\n\n| Set | Source trophies | Qualified | Included | Additional decisions |\n| --- | ---: | ---: | ---: | ---: |\n"
 for s in c['sets']:text+=f"| {s['id']} | {s['source_trophies']} | {s['qualified_trophies']} | {s['included_trophies']} | {s['additional_puzzles']} |\n"
 text+='\nErrors: '+json.dumps(c['errors'])+'\n'
 discovery=root/'discovery.json'
 if discovery.exists():text+='\nUnavailable archives: '+json.dumps(json.loads(discovery.read_text())['unavailable'])+'\n'
print(text)
if os.environ.get('GITHUB_STEP_SUMMARY'):
 with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:f.write(text)
