"""Publish validated public evidence to the dedicated status issue, not main."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path
import portfolio_apple_status as apple
import portfolio_play_status as play

REPO="killjoy00/mtg-ev-analyzer"
ISSUE=1867
ENDPOINT=f"repos/{REPO}/issues/{ISSUE}"
MARKER=re.compile(r"<!-- portfolio-status:start -->\n"+r"\x60{3}json\n(.*?)\n\x60{3}\n<!-- portfolio-status:end -->",re.S)
VALIDATORS={"apple":apple.validate,"play":play.validate}

def parse(body):
    matches=MARKER.findall(body)
    if len(matches)!=1:
        raise ValueError("Missing or duplicate machine-owned status marker")
    doc=json.loads(matches[0])
    if not isinstance(doc,dict) or not set(doc)<=set(VALIDATORS):
        raise ValueError("Unexpected snapshot keys")
    for platform,value in doc.items():
        VALIDATORS[platform](value)
    return doc

def merge(body,documents,run_id):
    current=parse(body)
    if not documents or not set(documents)<=set(VALIDATORS):
        raise ValueError("No approved new status evidence")
    for platform,value in documents.items():
        VALIDATORS[platform](value)
        if str(value["run_id"])!=str(run_id):
            raise ValueError("Unexpected workflow run")
        old=current.get(platform)
        if old is None or value["checked_at"]>=old["checked_at"]:
            current[platform]=value
    marker="<!-- portfolio-status:start -->\n"+chr(96)*3+"json\n"+json.dumps(current,indent=2)+"\n"+chr(96)*3+"\n<!-- portfolio-status:end -->"
    return MARKER.sub(lambda _:marker,body,count=1).replace("\n\nAwaiting the next validated Apple/Google read-back.","")

def gh(args,payload=None):
    proc=subprocess.run(["gh","api",ENDPOINT]+args,input=json.dumps(payload) if payload is not None else None,
                        text=True,capture_output=True,check=False)
    if proc.returncode:
        raise SystemExit("Status issue operation failed")
    return json.loads(proc.stdout)

def main():
    if os.environ.get("GITHUB_REPOSITORY")!=REPO or os.environ.get("GITHUB_REF")!="refs/heads/main":
        raise SystemExit("Wrong repository or ref")
    directory=Path(sys.argv[1])
    evidence={k:json.loads((directory/(k+".json")).read_text()) for k in VALIDATORS if (directory/(k+".json")).is_file()}
    issue=gh([])
    if issue.get("number")!=ISSUE or "pull_request" in issue:
        raise SystemExit("Wrong status issue")
    updated=merge(issue["body"],evidence,os.environ["GITHUB_RUN_ID"])
    saved=gh(["--method","PATCH","--input","-"],{"body":updated})
    if saved.get("body")!=updated:
        raise SystemExit("Issue read-back mismatch")
    print("Published validated status evidence to dedicated issue")

if __name__=="__main__":
    main()
