#!/usr/bin/env python3
"""GET-only app Apple release status. Publish only validated release metadata."""
import argparse
import base64
import datetime as dt
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

APPS = {"pack-one":"pro.packone.app"}
VERSION = re.compile(r"[0-9]+(?:\.[0-9]+){0,3}")
STAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
RESOURCE = re.compile(r"[A-Za-z0-9_-]+")
PROCESS = {"VALID","PROCESSING","FAILED","INVALID","UNKNOWN"}
BETA = {"IN_BETA_TESTING","READY_FOR_BETA_TESTING","EXPIRED","PROCESSING",
        "PROCESSING_EXCEPTION","MISSING_EXPORT_COMPLIANCE","IN_EXPORT_COMPLIANCE_REVIEW",
        "READY_FOR_BETA_SUBMISSION","WAITING_FOR_BETA_REVIEW","IN_BETA_REVIEW",
        "BETA_REJECTED","UNKNOWN"}
STORE = {"READY_FOR_DISTRIBUTION","READY_FOR_SALE","WAITING_FOR_REVIEW","IN_REVIEW",
         "PENDING_DEVELOPER_RELEASE","PENDING_APPLE_RELEASE","PREPARE_FOR_SUBMISSION",
         "PROCESSING_FOR_DISTRIBUTION","READY_FOR_REVIEW","ACCEPTED","REJECTED",
         "METADATA_REJECTED","DEVELOPER_REJECTED","INVALID_BINARY","REPLACED_WITH_NEW_VERSION",
         "WAITING_FOR_EXPORT_COMPLIANCE","DEVELOPER_REMOVED_FROM_SALE","REMOVED_FROM_SALE",
         "PENDING_CONTRACT","PREORDER_READY_FOR_SALE","UNKNOWN"}

def valid(pattern, x):
    return isinstance(x,str) and pattern.fullmatch(x) is not None

def state(x, allowed):
    return x if isinstance(x,str) and x in allowed else "UNKNOWN"

def attrs(row):
    return row.get("attributes",{}) if isinstance(row,dict) else {}

def rows(response):
    return response.get("data") if isinstance(response,dict) and isinstance(response.get("data"),list) else None

def rel(row,name):
    obj=row.get("relationships",{}).get(name,{}).get("data")
    return obj.get("id") if isinstance(obj,dict) else None

def token():
    import jwt
    raw=os.environ["ASC_KEY_P8"].replace("\r","").strip()
    if "BEGIN PRIVATE KEY" not in raw:
        if "\\n" in raw:
            raw=raw.replace("\\n","\n")
        else:
            try:
                decoded=base64.b64decode(raw).decode()
                if "BEGIN PRIVATE KEY" in decoded:
                    raw=decoded
            except (ValueError,UnicodeError):
                pass
    if "BEGIN PRIVATE KEY" not in raw:
        body="".join(raw.split())
        raw="-----BEGIN PRIVATE KEY-----\n"+"\n".join(body[i:i+64] for i in range(0,len(body),64))+"\n-----END PRIVATE KEY-----\n"
    now=int(time.time())
    return jwt.encode({"iss":os.environ["ASC_ISSUER_ID"],"iat":now,"exp":now+600,
                       "aud":"appstoreconnect-v1"},raw,algorithm="ES256",
                      headers={"kid":os.environ["ASC_KEY_ID"]})

def api(bearer):
    def get(path,params=None):
        url="https://api.appstoreconnect.apple.com/v1"+path
        if params:
            url+="?"+urllib.parse.urlencode(params)
        req=urllib.request.Request(url,headers={"Authorization":"Bearer "+bearer,
                                   "Accept":"application/json"},method="GET")
        try:
            with urllib.request.urlopen(req,timeout=15) as res:
                return json.loads(res.read(4_000_000))
        except (OSError,ValueError):
            return None
    return get

def collect(bundle,get):
    out={"bundle":bundle,"result":"unavailable","builds":[],"versions":[]}
    apps=rows(get("/apps",{"filter[bundleId]":bundle,"limit":5,"fields[apps]":"bundleId"}))
    if apps is None:
        return out
    matches=[a for a in apps if attrs(a).get("bundleId")==bundle and valid(RESOURCE,a.get("id"))]
    if len(matches)!=1:
        out["result"]="not_found" if not matches else "unavailable"
        return out
    app=matches[0]["id"]
    versions=rows(get(f"/apps/{app}/appStoreVersions",{"filter[platform]":"IOS","limit":50}))
    builds=get("/builds",{"filter[app]":app,"sort":"-uploadedDate","limit":30,
                         "include":"preReleaseVersion,buildBetaDetail",
                         "fields[builds]":"version,expired,processingState,preReleaseVersion,buildBetaDetail",
                         "fields[preReleaseVersions]":"version,platform",
                         "fields[buildBetaDetails]":"internalBuildState,externalBuildState"})
    if versions is not None:
        for row in versions:
            a=attrs(row)
            if a.get("platform")=="IOS" and valid(VERSION,a.get("versionString")):
                out["versions"].append({"version":a["versionString"],
                    "state":state(a.get("appVersionState") or a.get("appStoreState"),STORE)})
    if rows(builds) is not None:
        included={(i.get("type"),i.get("id")):attrs(i) for i in builds.get("included",[]) if isinstance(i,dict)}
        for row in rows(builds):
            a=attrs(row)
            pre=included.get(("preReleaseVersions",rel(row,"preReleaseVersion")),{})
            beta=included.get(("buildBetaDetails",rel(row,"buildBetaDetail")),{})
            if pre.get("platform")!="IOS" or not valid(VERSION,pre.get("version")) or not valid(VERSION,a.get("version")):
                continue
            if not beta and valid(RESOURCE,row.get("id")):
                detail=get(f"/builds/{row['id']}/buildBetaDetail",{"fields[buildBetaDetails]":"internalBuildState,externalBuildState"})
                beta=attrs(detail.get("data")) if isinstance(detail,dict) else {}
            out["builds"].append({"version":pre["version"],"build":a["version"],
                "processing":state(a.get("processingState"),PROCESS),
                "internal":state(beta.get("internalBuildState"),BETA),
                "external":state(beta.get("externalBuildState"),BETA),
                "expired":a.get("expired") is not False})
    out["result"]="ok" if versions is not None and rows(builds) is not None else "partial"
    return out

def validate(doc):
    assert set(doc)=={"schema_version","checked_at","run_id","apps"} and doc["schema_version"]==1
    assert valid(STAMP,doc["checked_at"]) and re.fullmatch(r"[1-9][0-9]{0,19}",str(doc["run_id"]))
    assert set(doc["apps"])==set(APPS)
    for key,a in doc["apps"].items():
        assert set(a)=={"bundle","result","builds","versions"} and a["bundle"]==APPS[key]
        assert a["result"] in {"ok","partial","unavailable","not_found"}
        assert len(a["builds"])<=30 and len(a["versions"])<=50
        for b in a["builds"]:
            assert set(b)=={"version","build","processing","internal","external","expired"}
            assert valid(VERSION,b["version"]) and valid(VERSION,b["build"])
            assert b["processing"] in PROCESS and b["internal"] in BETA and b["external"] in BETA
            assert type(b["expired"]) is bool
        for v in a["versions"]:
            assert set(v)=={"version","state"} and valid(VERSION,v["version"]) and v["state"] in STORE

def main():
    p=argparse.ArgumentParser()
    p.add_argument("path",type=Path)
    p.add_argument("--validate",action="store_true")
    a=p.parse_args()
    if a.validate:
        validate(json.loads(a.path.read_text()))
        return
    try:
        get=api(token())
    except Exception:
        raise SystemExit("Apple authentication configuration unavailable") from None
    doc={"schema_version":1,"checked_at":dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "run_id":os.environ["GITHUB_RUN_ID"],"apps":{k:collect(v,get) for k,v in APPS.items()}}
    validate(doc)
    if not any(x["result"] in {"ok","partial"} for x in doc["apps"].values()):
        raise SystemExit("No Apple records verified; preserving previous snapshot")
    a.path.parent.mkdir(parents=True,exist_ok=True)
    a.path.write_text(json.dumps(doc,indent=2)+"\n")
    for k,v in doc["apps"].items():
        print(f"{k}: {v['result']}; {len(v['builds'])} builds; {len(v['versions'])} versions")

if __name__=="__main__":
    main()
