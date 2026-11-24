"""Offline tests for the bounded, pinned public archive downloader."""
import hashlib
import io
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from prepare_pack_one_lab import fetch_pinned, fetch_with_retry, SourceFailure, authorized_actions, authorized_validation, URLS

class Response(io.BytesIO):
    def __init__(self,data,url):
        super().__init__(data)
        self.url=url
    def geturl(self):
        return self.url

class Opener:
    def __init__(self,data,url):
        self.data,self.url=data,url
    def open(self,request,timeout):
        if request.full_url!=URLS['draft'] or timeout!=60:
            raise AssertionError('unexpected source')
        return Response(self.data,self.url)

class LabArchiveDownloadTests(unittest.TestCase):
    def test_pinned_bytes_only(self):
        data=b'synthetic archive bytes'
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'draft.gz'
            with patch.dict('prepare_pack_one_lab.PINS',{'draft':hashlib.sha256(data).hexdigest()}):
                fetch_pinned('draft',path,Opener(data,URLS['draft']))
                self.assertEqual(path.read_bytes(),data)
                with self.assertRaises(FileExistsError):
                    fetch_pinned('draft',path,Opener(data,URLS['draft']))
                with self.assertRaisesRegex(ValueError,'hash-mismatch'):
                    fetch_pinned('draft',Path(temp)/'other.gz',Opener(b'changed',URLS['draft']))
                with self.assertRaisesRegex(ValueError,'redirect'):
                    fetch_pinned('draft',Path(temp)/'redirect.gz',Opener(data,'https://example.invalid/'))
                with patch('prepare_pack_one_lab.MAX_COMPRESSED_BYTES',1):
                    with self.assertRaisesRegex(ValueError,'too-large'):
                        fetch_pinned('draft',Path(temp)/'large.gz',Opener(data,URLS['draft']))

    def test_retry_only_transient_public_source_errors(self):
        data=b'synthetic archive bytes'
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'draft.gz'
            attempts=[]
            waits=[]
            def transient(kind,destination):
                attempts.append(kind)
                destination.write_bytes(b'partial' if len(attempts)==1 else data)
                if len(attempts)==1:
                    raise urllib.error.HTTPError(URLS[kind],503,'not logged',None,None)
            with patch.dict('prepare_pack_one_lab.SOURCE_BYTES',{'draft':len(data)}):
                fetch_with_retry('draft',path,fetch=transient,sleep=waits.append)
            self.assertEqual(attempts,['draft','draft'])
            self.assertEqual(waits,[1])
            self.assertEqual(path.read_bytes(),data)
            path.unlink()
            attempts.clear()
            def denied(kind,destination):
                attempts.append(kind)
                raise urllib.error.HTTPError(URLS[kind],403,'not logged',None,None)
            with self.assertRaisesRegex(SourceFailure,'lab-source-http-403'):
                fetch_with_retry('draft',path,fetch=denied,sleep=waits.append)
            self.assertEqual(attempts,['draft'])

    def test_changed_hash_or_size_is_not_retried(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'draft.gz'
            waits=[]
            def changed(kind,destination):
                raise ValueError('lab-source-hash-mismatch')
            with self.assertRaisesRegex(SourceFailure,'hash-mismatch'):
                fetch_with_retry('draft',path,fetch=changed,sleep=waits.append)
            with patch.dict('prepare_pack_one_lab.SOURCE_BYTES',{'draft':1}):
                with self.assertRaisesRegex(SourceFailure,'size-mismatch'):
                    fetch_with_retry('draft',path,fetch=lambda _,p:p.write_bytes(b'longer'),sleep=waits.append)
            self.assertEqual(waits,[])

    def test_actions_gate(self):
        gate={'GITHUB_REF':'refs/heads/main','GITHUB_REPOSITORY':'killjoy00/mtg-ev-analyzer',
              'GITHUB_WORKFLOW':'Pack One Lab private editorial review','PACK1_LAB_REVIEW_ENABLED':'true'}
        with patch.dict(os.environ,gate,clear=True):
            self.assertTrue(authorized_actions())
            with patch.dict(os.environ,{'GITHUB_REF':'refs/pull/1792/merge'}):
                self.assertFalse(authorized_actions())
            with patch.dict(os.environ,{'PACK1_LAB_REVIEW_ENABLED':'false'}):
                self.assertFalse(authorized_actions())

    def test_validation_cannot_enable_production(self):
        gate={'GITHUB_EVENT_NAME':'pull_request','GITHUB_REPOSITORY':'killjoy00/mtg-ev-analyzer',
              'GITHUB_WORKFLOW':'Pack One Lab archive validation','GITHUB_REF':'refs/pull/1792/merge'}
        with patch.dict(os.environ,gate,clear=True):
            self.assertTrue(authorized_validation())
            self.assertFalse(authorized_actions())
            with patch.dict(os.environ,{'GITHUB_EVENT_NAME':'push'}):
                self.assertFalse(authorized_validation())

if __name__=='__main__':
    unittest.main()
