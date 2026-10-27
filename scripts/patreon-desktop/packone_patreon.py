"""Pack One's local PostyBirb bridge. No Patreon cookies or remote control port."""
import datetime as dt
import hashlib
import hmac
import html
import http.client
import json
import os
from pathlib import Path
import re
import socket
import shutil
import ssl
import sys
import threading
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

BASE = 'https://raw.githubusercontent.com/killjoy00/mtg-ev-analyzer/packone-patreon-feed/'
CAMPAIGN = '16808916'
MAX_BYTES = 12_000_000
STATE = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'PackOnePatreon'


class BridgeError(Exception):
    pass


def require(ok, message):
    if not ok:
        raise BridgeError(message)


def public_url(value):
    return isinstance(value, str) and bool(re.fullmatch(r'https://www\.patreon\.com/posts/[A-Za-z0-9_-]+', value))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise BridgeError('Unexpected download redirect; stopped.')


def download(path):
    require(re.fullmatch(r'(latest\.json|20\d\d-\d\d-\d\d/featured-cover\.jpg)', path), 'Invalid feed path.')
    req = urllib.request.Request(BASE + path + '?v=' + str(int(dt.datetime.now().timestamp()) // 60),
                                 headers={'User-Agent': 'PackOnePatreon/1', 'Cache-Control': 'no-cache'})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=25) as response:
        data = response.read(MAX_BYTES + 1)
    require(len(data) <= MAX_BYTES, 'Download too large; stopped.')
    return data


def validate_feed(feed, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(ZoneInfo('America/Los_Angeles')).date()
    require(feed.get('version') == 1 and feed.get('publication_day') == str(today),
            "Today's post is not ready yet. The helper will check again.")
    day = str(today - dt.timedelta(days=1))
    require(feed.get('feature_day') == day and feed.get('campaign_id') == CAMPAIGN
            and feed.get('public') is True, 'Unexpected post destination or date; stopped.')
    require(isinstance(feed.get('title'), str) and 0 < len(feed['title']) <= 150
            and feed['title'].endswith(' | Pack One Daily ' + day), 'Invalid post title.')
    require(isinstance(feed.get('body'), str) and day in feed['body']
            and 'https://packone.pro/' in feed['body'] and len(feed['body']) < 30000
            and not any(c in feed['body'] for c in '{}'), 'Invalid post text.')
    require(feed.get('image_path') == str(today) + '/featured-cover.jpg'
            and re.fullmatch(r'[a-f0-9]{64}', feed.get('image_sha256', '')), 'Invalid image manifest.')
    try:
        checked = dt.datetime.fromisoformat(feed['checked_at'].replace('Z', '+00:00'))
        age = (now - checked).total_seconds()
    except (KeyError, ValueError, TypeError):
        raise BridgeError('Public-post check is unavailable; stopped.') from None
    require(-120 <= age <= 1800 and feed.get('read_check') == 'ok',
            'Waiting for a fresh public-post check. Please leave the helper open.')
    require(feed.get('verified_public_url') is None or public_url(feed['verified_public_url']),
            'Invalid public post link.')
    return feed


def post_html(body):
    return ''.join('<p>' + html.escape(p).replace('\n', '<br />') + '</p>' for p in body.split('\n\n'))


class PinnedConnection(http.client.HTTPSConnection):
    """Trust the app's exact local certificate before sending its auth header.

    PostyBirb generates its own self-signed certificate. PKI verification is
    replaced ONLY on this loopback socket by exact certificate pinning.
    """
    def __init__(self, certificate):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        self.expected = ssl.PEM_cert_to_DER_cert(certificate)
        super().__init__('127.0.0.1', 9247, timeout=35, context=context)

    def connect(self):
        sock = socket.create_connection(('127.0.0.1', 9247), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname='postybirb.com')
            require(hmac.compare_digest(self.sock.getpeercert(binary_form=True), self.expected),
                    'PostyBirb certificate changed; stopped before sending credentials.')
        except Exception:
            sock.close()
            if self.sock:
                self.sock.close()
            raise


class PostyBirb:
    def __init__(self):
        appdata = Path(os.environ.get('APPDATA', ''))
        candidates = []
        for name in ('postybirb-plus', 'PostyBirb+'):
            root = appdata / name / 'data'
            try:
                token = (root / 'id.txt').read_text().strip()
                certificate = (root / 'cert.pem').read_text()
                require(bool(re.fullmatch(r'[A-Za-z0-9_-]{10,100}', token)), 'Invalid local auth data.')
                candidates.append((token, certificate))
            except (OSError, BridgeError):
                continue
        require(bool(candidates), 'Open PostyBirb+ on this Windows account, then try again.')
        # Packaged Electron versions can use either product name. The active
        # listener's certificate identifies the correct profile without sending auth.
        if len(candidates) > 1:
            active = []
            for token, certificate in candidates:
                connection = PinnedConnection(certificate)
                try:
                    connection.connect()
                    active.append((token, certificate))
                except (OSError, BridgeError):
                    pass
                finally:
                    connection.close()
            candidates = active
        require(len(candidates) == 1, 'Cannot identify the active PostyBirb profile. Keep PostyBirb open.')
        self.token, self.certificate = candidates[0]

    def request(self, method, path, body=None, content_type='application/json'):
        require(path.startswith('/') and not path.startswith('//') and '\r' not in path
                and '\n' not in path, 'Invalid local request.')
        conn = PinnedConnection(self.certificate)
        try:
            # Explicit connect enforces the pin before HTTP/auth bytes are sent.
            conn.connect()
            headers = {'Authorization': self.token}
            if body is not None:
                headers['Content-Type'] = content_type
                if not isinstance(body, bytes):
                    body = json.dumps(body).encode()
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            data = response.read(MAX_BYTES + 1)
            require(200 <= response.status < 300 and len(data) <= MAX_BYTES,
                    'PostyBirb did not accept the request. Check its window for details.')
            return json.loads(data) if data else None
        finally:
            conn.close()

    def account(self):
        accounts = self.request('GET', '/account/statuses')
        require(isinstance(accounts, list), 'Unexpected PostyBirb account response.')
        matches = []
        for account in accounts:
            if account.get('website') != 'Patreon' or account.get('loggedIn') is not True:
                continue
            aid = urllib.parse.quote(str(account['_id']), safe='')
            campaign = self.request('GET', '/patreon/info/' + aid + '?prop=campaignId')
            if str(campaign) == CAMPAIGN:
                matches.append((account, aid))
        require(len(matches) == 1, 'PostyBirb needs exactly one logged-in Pack One Patreon account.')
        account, aid = matches[0]
        folders = self.request('GET', '/patreon/folders/' + aid)
        everyone = [f['value'] for f in folders if f.get('label') == 'Everyone']
        require(len(everyone) == 1 and isinstance(everyone[0], str),
                'Could not confirm the Everyone audience. No post was queued.')
        return account['_id'], everyone[0]

    def existing(self, title):
        logs = self.request('GET', '/submission-log/FILE')
        submissions = self.request('GET', '/submission?type=FILE&packaged=true')
        require(isinstance(logs, list) and isinstance(submissions, list), 'Cannot check local post history.')
        for record in logs:
            for part in record.get('parts', []):
                p = part.get('part', {})
                if p.get('website') == 'Patreon' and p.get('data', {}).get('title') == title:
                    return True
        for record in submissions:
            for p in record.get('parts', {}).values():
                if p.get('website') == 'Patreon' and p.get('data', {}).get('title') == title:
                    return True
        return False

    def create(self, feed, cover, account_id, everyone):
        options = {'title': feed['title'], 'description': {'value': post_html(feed['body']), 'overwriteDefault': True},
                   'tags': {'value': [], 'extendDefault': False}, 'rating': 'general', 'sources': [],
                   'tiers': [everyone], 'charge': False, 'collections': [], 'allAsAttachment': False,
                   'useThumbnail': False, 'autoScale': False}
        parts = [{'accountId': account_id, 'website': 'Patreon', 'isDefault': False, 'data': options}]
        boundary = 'PackOne' + uuid.uuid4().hex
        chunks = []
        for name, value in [('type', 'FILE'), ('title', feed['title']), ('parts', json.dumps(parts))]:
            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="featured-cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode())
        chunks.extend([cover, f'\r\n--{boundary}--\r\n'.encode()])
        submission = self.request('POST', '/submission/create', b''.join(chunks), 'multipart/form-data; boundary=' + boundary)
        sid = submission.get('_id', '')
        require(isinstance(sid, str) and re.fullmatch(r'[A-Za-z0-9_-]+', sid), 'Cannot confirm the created local draft.')
        package = self.request('GET', '/submission/' + sid + '?packaged=true')
        verify_package(package, account_id, options, len(cover))
        return sid


def verify_package(package, account_id, options, image_size):
    parts = [p for p in package.get('parts', {}).values() if not p.get('isDefault')]
    require(len(parts) == 1 and parts[0].get('website') == 'Patreon'
            and parts[0].get('accountId') == account_id, 'Unexpected posting destination; stopped.')
    require(not package.get('hasProblems', True), 'PostyBirb reported a validation problem. Check its window.')
    for problem in package.get('problems', {}).values():
        require(not problem.get('problems'), 'PostyBirb reported a validation problem.')
    for key, value in options.items():
        require(parts[0].get('data', {}).get(key) == value, 'PostyBirb changed a post option; stopped.')
    data = parts[0]['data']
    require(not any(data.get(k) for k in ('schedule', 'earlyAccess', 'teaser')), 'Unexpected scheduling option.')
    submission = package.get('submission', {})
    require(not submission.get('schedule', {}).get('isScheduled') and not submission.get('additional')
            and submission.get('primary', {}).get('mimetype') == 'image/jpeg'
            and submission['primary'].get('size') == image_size, 'Unexpected image or schedule; stopped.')


class Journal:
    def __init__(self, root=STATE):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def claim(self, feed):
        path = self.root / (feed['publication_day'] + '.json')
        try:
            with path.open('x', encoding='utf-8') as handle:
                json.dump({'title': feed['title'], 'state': 'claimed', 'image_sha256': feed['image_sha256']}, handle)
                handle.flush()
                os.fsync(handle.fileno())
        except FileExistsError:
            raise BridgeError('Already attempted today. Waiting for verification; no duplicate will be queued.') from None
        return path

    def record(self, path, state, **data):
        tmp = path.with_suffix('.tmp')
        with tmp.open('w', encoding='utf-8') as handle:
            json.dump({'state': state, **data}, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)


def run_once(publish=False, fetch=download, client_factory=PostyBirb, journal=None):
    feed = validate_feed(json.loads(fetch('latest.json')))
    if feed['verified_public_url']:
        return 'Public post verified: ' + feed['verified_public_url'], True
    client = client_factory()
    account, everyone = client.account()
    if not publish:
        return 'Connected to Pack One. Today’s post is ready. Click Publish today once.', False
    require(not client.existing(feed['title']), 'A matching post or draft exists in PostyBirb. No duplicate was queued.')
    cover = fetch(feed['image_path'])
    require(5000 <= len(cover) <= MAX_BYTES and cover.startswith(b'\xff\xd8\xff')
            and hashlib.sha256(cover).hexdigest() == feed['image_sha256'], 'Image validation failed; stopped.')
    validate_feed(feed)  # Downloads must not carry an old day over midnight.
    journal = journal or Journal()
    claim = journal.claim(feed)  # Before any local mutation; even a timed-out draft is not blindly retried.
    sid = client.create(feed, cover, account, everyone)
    journal.record(claim, 'queue-uncertain', submission_id=sid, title=feed['title'])
    client.request('POST', '/post/queue/' + sid)
    journal.record(claim, 'queued', submission_id=sid, title=feed['title'])
    return 'Sent to PostyBirb. Waiting for the public-post check (up to 20 minutes).', False


def lock_instance():
    STATE.mkdir(parents=True, exist_ok=True)
    handle = (STATE / 'running.lock').open('a+b')
    handle.seek(0)
    handle.write(b'0')
    handle.flush()
    handle.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle


def automatic_settings():
    try:
        data = json.loads((STATE / 'automatic.json').read_text())
        return data.get('enabled') is True and data.get('verified_once') is True
    except (OSError, ValueError, AttributeError):
        return False


def save_automatic(enabled):
    # Opt-in includes starting the installed helper at Windows sign-in.
    # No scheduled task, administrator privileges or open inbound port.
    if os.name == 'nt' and getattr(sys, 'frozen', False):
        import winreg
        target = STATE / 'PackOnePatreon.exe'
        if enabled and Path(sys.executable).resolve() != target.resolve():
            shutil.copy2(sys.executable, target)
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
            if enabled:
                winreg.SetValueEx(key, 'PackOnePatreon', 0, winreg.REG_SZ, '"' + str(target) + '"')
            else:
                try:
                    winreg.DeleteValue(key, 'PackOnePatreon')
                except FileNotFoundError:
                    pass
    (STATE / 'automatic.json').write_text(json.dumps({'enabled': enabled, 'verified_once': True}))


def gui():
    import tkinter as tk
    from tkinter import messagebox
    import queue
    try:
        instance_lock = lock_instance()
    except OSError:
        messagebox.showinfo('Pack One Patreon', 'The helper is already running.')
        return
    root = tk.Tk()
    root.title('Pack One → Patreon')
    root.geometry('610x330')
    root.resizable(False, False)
    messages = queue.Queue()
    busy = False
    verified = automatic_settings()
    auto = tk.BooleanVar(value=verified)
    status = tk.StringVar(value='Keep PostyBirb open. Checking the connection…')
    tk.Label(root, text='Pack One → Patreon', font=('Segoe UI', 19, 'bold')).pack(pady=(20, 8))
    tk.Label(root, text='Uses your saved PostyBirb login. Posts are public and free.', font=('Segoe UI', 10)).pack()
    tk.Label(root, textvariable=status, wraplength=550, justify='left', font=('Segoe UI', 11)).pack(padx=25, pady=20)
    buttons = tk.Frame(root)
    buttons.pack()

    def work(publish=False):
        nonlocal busy
        if busy:
            return
        busy = True
        status.set('Checking today’s post and PostyBirb…')
        def worker():
            try:
                messages.put(run_once(publish))
            except BridgeError as error:
                messages.put((str(error), False))
            except Exception:
                # Never show raw auth-bearing network exceptions or account records.
                messages.put(('Connection unavailable. Keep PostyBirb open and check again. If a post was attempted, it will not be queued twice.', False))
        threading.Thread(target=worker, daemon=True).start()

    tk.Button(buttons, text='Check connection', command=work, width=20).pack(side='left', padx=5)
    tk.Button(buttons, text='Publish today', command=lambda: work(True), width=20).pack(side='left', padx=5)
    auto_button = tk.Checkbutton(root, text='Post automatically and start this helper at Windows sign-in', variable=auto,
                                 state='normal' if verified else 'disabled')
    auto_button.pack(pady=(18, 3))
    tk.Label(root, text='Automatic mode unlocks after a public post is verified.\nYour PC, this helper and PostyBirb must stay running.', fg='#555', font=('Segoe UI', 9)).pack()

    def poll_messages():
        nonlocal busy, verified
        try:
            message, found = messages.get_nowait()
            status.set(message)
            busy = False
            if found:
                verified = True
                auto_button.config(state='normal')
        except queue.Empty:
            pass
        root.after(200, poll_messages)

    def save_auto(*_):
        if verified:
            try:
                save_automatic(auto.get())
            except OSError:
                auto.set(False) if auto.get() else None
                status.set('Could not save automatic startup. Leave the helper open and try again.')
    auto.trace_add('write', save_auto)
    def scheduled():
        work(auto.get() and verified)
        root.after(300000, scheduled)
    root.after(200, poll_messages)
    root.after(500, scheduled)
    root.mainloop()
    instance_lock.close()


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        assert ZoneInfo('America/Los_Angeles')
        assert post_html('<x>\nline') == '<p>&lt;x&gt;<br />line</p>'
        assert public_url('https://www.patreon.com/posts/123')
        assert not public_url('https://evil.example/posts/123')
        if getattr(sys, 'frozen', False):
            # --noconsole builds have no stdout. A packaging check needs evidence.
            Path(sys.executable).with_name('runtime-self-test.ok').write_text('passed')
        elif sys.stdout is not None:
            print('Pack One desktop runtime self-test passed')
    else:
        gui()
