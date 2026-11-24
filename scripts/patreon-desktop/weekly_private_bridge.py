"""Private stdin-only adapter for the existing pinned local PostyBirb client.

No CLI payloads, no public feed, no production data in stdout/stderr.
Only the local Node runner calls this; do not expose it as a network service.
"""
import base64
import hashlib
import json
import os
import re
import sys
from packone_patreon import PostyBirb, verify_package, verify_draft_image, patreon_options, MAX_BYTES, require

def allowed_environment():
    return (os.environ.get('PACKONE_WEEKLY_PRIVATE_RUNTIME') == 'true'
            and os.environ.get('PACKONE_WEEKLY_PUBLICATION_ENABLED') == 'true'
            and os.environ.get('PACKONE_WEEKLY_NOTICE_VERIFIED') == 'true'
            and not any(os.environ.get(k) for k in ('GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'CI')))

def valid_payload(data):
    require(isinstance(data, dict), 'invalid')
    require(bool(re.fullmatch(r'Pack One Weekly \| 20\d\d-\d\d-\d\d', data.get('title', ''))), 'invalid')
    require(isinstance(data.get('body'), str) and len(data['body']) < 4000
            and 'https://packone.pro/' in data['body']
            and 'https://apps.apple.com/app/id6814318676' in data['body']
            and 'https://play.google.com/store/apps/details?id=pro.packone.app' in data['body'], 'invalid')
    require(bool(re.fullmatch(r'[0-9a-f]{64}', data.get('image_sha256', ''))), 'invalid')
    return {key: data[key] for key in ('title', 'body', 'image_sha256')}

def handle(data, client):
    if data == {'action': 'check'}:
        client.account()
        return {'connected': True}
    feed = valid_payload(data)
    account, everyone = client.account()
    if data.get('action') == 'stage':
        cover = base64.b64decode(data.get('image_b64', ''), validate=True)
        require(5000 <= len(cover) <= MAX_BYTES and cover.startswith(b'\xff\xd8\xff')
                and hashlib.sha256(cover).hexdigest() == feed['image_sha256'], 'invalid')
        require(not client.existing(feed['title']), 'existing')
        # Create and verify the exact local draft, without any queue request.
        sid = client.create(feed, cover, account, everyone)
        return {'id': sid}
    if data.get('action') == 'queue':
        sid = data.get('id', '')
        require(isinstance(sid, str) and bool(re.fullmatch(r'[A-Za-z0-9_-]+', sid)), 'invalid')
        size = data.get('image_size')
        require(isinstance(size, int) and 5000 <= size <= MAX_BYTES, 'invalid')
        logged, drafts = client.history(feed['title'])
        require(not logged and len(drafts) == 1 and drafts[0].get('submission', {}).get('_id') == sid, 'existing')
        package = client.request('GET', '/submission/' + sid + '?packaged=true')
        verify_package(package, account, patreon_options(feed, everyone), size)
        verify_draft_image(package, feed['image_sha256'])
        client.request('POST', '/post/queue/' + sid)
        return {'queued': True}
    raise ValueError('invalid')

def main():
    if not allowed_environment():
        raise ValueError('private')
    raw = sys.stdin.buffer.read(18_000_001)
    require(len(raw) <= 18_000_000, 'invalid')
    data = json.loads(raw)
    return handle(data, PostyBirb())

if __name__ == '__main__':
    try:
        result = main()
        print(json.dumps(result))
    except Exception:
        # Never print exception messages, data, URLs, or local account details.
        print('{"error":"private-publisher-failed"}')
        sys.exit(1)
