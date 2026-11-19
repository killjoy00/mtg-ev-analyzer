"""Remove permanently retired environment data without logging environment names."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from set_policy import supported_set

def retired_path(path):
    return any(not supported_set(token) for token in re.split(r'[/_.-]+',str(path)))

def purge_local(root):
    removed=0
    for base in [root/'data',root/'generated/trophy-import']:
        if not base.exists():continue
        for p in sorted(base.rglob('*'),key=lambda p:len(p.parts)):
            if p.exists() and retired_path(p.relative_to(base)):
                if p.is_dir():shutil.rmtree(p)
                else:p.unlink()
                removed+=1
    return removed

def purge_remote():
    import os
    endpoint=os.environ['R2_ENDPOINT'];bucket=os.environ['R2_BUCKET']
    def aws(*args):
        return json.loads(subprocess.check_output(['aws','s3api',*args,'--endpoint-url',endpoint,'--output','json'],text=True) or '{}')
    objects=aws('list-objects-v2','--bucket',bucket,'--prefix','data/').get('Contents',[])
    keys=[{'Key':o['Key']} for o in objects if retired_path(o['Key'])]
    for i in range(0,len(keys),1000):
        r=aws('delete-objects','--bucket',bucket,'--delete',json.dumps({'Objects':keys[i:i+1000],'Quiet':True}))
        if r.get('Errors'):raise RuntimeError('Retired-object purge failed')
    return len(keys)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--remote',action='store_true');args=p.parse_args()
    result={'local_paths_removed':purge_local(Path(__file__).resolve().parents[1])}
    if args.remote:result['remote_objects_removed']=purge_remote()
    print(json.dumps(result))
