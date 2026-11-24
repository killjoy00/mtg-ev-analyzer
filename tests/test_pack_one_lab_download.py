"""Offline tests for the bounded, pinned public archive downloader."""
import hashlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from prepare_pack_one_lab import fetch_pinned, authorized_actions, URLS

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

    def test_actions_gate(self):
        gate={'GITHUB_REF':'refs/heads/main','GITHUB_REPOSITORY':'killjoy00/mtg-ev-analyzer',
              'GITHUB_WORKFLOW':'Pack One Lab private editorial review','PACK1_LAB_REVIEW_ENABLED':'true'}
        with patch.dict(os.environ,gate,clear=True):
            self.assertTrue(authorized_actions())
            with patch.dict(os.environ,{'GITHUB_REF':'refs/pull/1792/merge'}):
                self.assertFalse(authorized_actions())
            with patch.dict(os.environ,{'PACK1_LAB_REVIEW_ENABLED':'false'}):
                self.assertFalse(authorized_actions())

if __name__=='__main__':
    unittest.main()
