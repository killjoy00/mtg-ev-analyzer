#!/usr/bin/env python3
"""Discover official archives and release metadata; never publish a set."""
import json
from pathlib import Path
import time
import urllib.error
from import_all_trophies import discover, request, BASE, atomic_json

def main():
    sources, document = discover()
    records=[]
    for sid, expansion in sorted(sources.items()):
        item={'set_id':sid,'event_type':'PremierDraft','archive_url':f'{BASE}/draft_data/draft_data_public.{expansion}.PremierDraft.csv.gz','expansion':expansion}
        try:
            with request(item['archive_url'],'HEAD') as r:
                item.update(archive_available=True,archive_etag=r.headers.get('ETag'),archive_last_modified=r.headers.get('Last-Modified'))
            if sid=='powered-cube':
                item.update(set_name='Powered Cube',regular_run=False,release_date=None)
            else:
                time.sleep(.15)
                with request('https://api.scryfall.com/sets/'+sid) as r: metadata=json.load(r)
                if metadata.get('code')!=sid or not metadata.get('released_at'): raise ValueError('Set metadata identity or release date missing')
                item.update(set_name=metadata['name'],release_date=metadata['released_at'],regular_run=metadata.get('set_type') in {'expansion','core','masters','draft_innovation'})
        except Exception as e:
            item['error']=f'{type(e).__name__}: {e}'
            # A metadata error is distinct from an unavailable source archive.
            item.setdefault('archive_available',False)
        records.append(item)
    for absent in document['unavailable']:
        sid=absent['expansion'].lower()
        if sid.replace('-','').isalnum(): records.append({'set_id':sid,'event_type':'PremierDraft','archive_available':False,'error':absent['reason']})
    output=Path('generated/corpus-operations');output.mkdir(parents=True,exist_ok=True)
    atomic_json(output/'discovery.json',{'source':document,'sets':records})
    print(f'Discovered {len(records)} environments; none published.')

if __name__=='__main__': main()
