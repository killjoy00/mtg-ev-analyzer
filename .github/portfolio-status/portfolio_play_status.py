#!/usr/bin/env python3
"""Read Play track release lifecycle without creating or committing an edit."""
import argparse
import datetime as dt
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

APPS = {"pack-one":"pro.packone.app"}
TRACKS=("production","internal")
STATES={"UNSPECIFIED","DRAFT","NOT_SENT_FOR_REVIEW","IN_REVIEW","APPROVED_NOT_PUBLISHED","NOT_APPROVED","PUBLISHED"}
PREFIX="RELEASE_LIFECYCLE_STATE_"
STAMP=re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")

def collect(package,track,get):
    path=f"/applications/{package}/tracks/{track}/releases"
    payload=get(path)
    if payload is None or not isinstance(payload,dict) or not isinstance(payload.get("releases",[]),list):
        return {"result":"unavailable","releases":[]}
    releases=[]
    for release in payload.get("releases",[]):
        if not isinstance(release,dict) or release.get("track",track)!=track:
            continue
        status=release.get("releaseLifecycleState","")
        status=status[len(PREFIX):] if isinstance(status,str) and status.startswith(PREFIX) else "UNSPECIFIED"
        if status not in STATES:
            status="UNSPECIFIED"
        codes=[]
        for a in release.get("activeArtifacts",[]) or []:
            if not isinstance(a,dict):
                continue
            code=a.get("versionCode")
            if re.fullmatch(r"[1-9][0-9]{0,9}",str(code)):
                codes.append(str(code))
        releases.append({"state":status,"codes":sorted(set(codes),key=int)})
    return {"result":"ok","releases":releases}

def reader(token):
    def get(path):
        request=urllib.request.Request("https://androidpublisher.googleapis.com/androidpublisher/v3"+path,
            headers={"Authorization":"Bearer "+token,"Accept":"application/json"},method="GET")
        try:
            with urllib.request.urlopen(request,timeout=20) as response:
                return json.loads(response.read(2_000_000))
        except (OSError,ValueError):
            return None
    return get

def validate(doc):
    assert set(doc)=={"schema_version","checked_at","run_id","apps"} and doc["schema_version"]==1
    assert STAMP.fullmatch(doc["checked_at"]) and re.fullmatch(r"[1-9][0-9]{0,19}",str(doc["run_id"]))
    assert set(doc["apps"])==set(APPS)
    for key,a in doc["apps"].items():
        assert set(a)=={"package","tracks"} and a["package"]==APPS[key]
        assert set(a["tracks"])==set(TRACKS)
        for track in a["tracks"].values():
            assert set(track)=={"result","releases"} and track["result"] in {"ok","unavailable"}
            assert len(track["releases"])<=20
            for rel in track["releases"]:
                assert set(rel)=={"state","codes"} and rel["state"] in STATES
                assert all(isinstance(c,str) and re.fullmatch(r"[1-9][0-9]{0,9}",c) for c in rel["codes"])

def main():
    p=argparse.ArgumentParser()
    p.add_argument("path",type=Path)
    p.add_argument("--validate",action="store_true")
    a=p.parse_args()
    if a.validate:
        validate(json.loads(a.path.read_text()))
        return
    get=reader(os.environ["GOOGLE_PLAY_ACCESS_TOKEN"])
    doc={"schema_version":1,"checked_at":dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "run_id":os.environ["GITHUB_RUN_ID"],"apps":{k:{"package":v,"tracks":{t:collect(v,t,get) for t in TRACKS}} for k,v in APPS.items()}}
    validate(doc)
    if not any(t["result"]=="ok" for app in doc["apps"].values() for t in app["tracks"].values()):
        raise SystemExit("No Play tracks verified; preserving previous snapshot")
    a.path.parent.mkdir(parents=True,exist_ok=True)
    a.path.write_text(json.dumps(doc,indent=2)+"\n")
    for k,v in doc["apps"].items():
        print(f"{k}: "+", ".join(f"{t} {o['result']} ({len(o['releases'])} releases)" for t,o in v["tracks"].items()))

if __name__=="__main__":
    main()
