import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('packone_patreon', Path(__file__).parents[1] / 'scripts/patreon-desktop/packone_patreon.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def fixture():
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(bridge.ZoneInfo('America/Los_Angeles')).date()
    day = str(today - dt.timedelta(days=1))
    cover = b'\xff\xd8\xff' + b'x' * 6000
    feed = {'version': 1, 'publication_day': str(today), 'feature_day': day,
            'campaign_id': bridge.CAMPAIGN, 'public': True,
            'title': 'Real feature | Pack One Daily ' + day,
            'body': day + '\nhttps://packone.pro/', 'image_path': str(today) + '/featured-cover.jpg',
            'image_sha256': hashlib.sha256(cover).hexdigest(), 'checked_at': now.isoformat(),
            'read_check': 'ok', 'verified_public_url': None}
    return feed, cover


class FakeClient:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def account(self):
        return 'account', 'everyone'

    def existing(self, title):
        return False

    def create(self, *args):
        self.calls.append('create')
        return 'submission'

    def request(self, method, path):
        self.calls.append('queue')
        if self.fail:
            raise TimeoutError('ambiguous')


class DesktopTests(unittest.TestCase):
    def test_feed_rejects_stale_paid_wrong_campaign_and_wrong_image(self):
        feed, _ = fixture()
        bridge.validate_feed(feed)
        for key, value in [('publication_day', '2000-01-01'), ('public', False),
                           ('campaign_id', 'other'), ('image_path', '../private'),
                           ('checked_at', '2000-01-01T00:00:00Z'),
                           ('verified_public_url', 'https://evil.test/posts/12')]:
            with self.subTest(key=key), self.assertRaises(bridge.BridgeError):
                bridge.validate_feed({**feed, key: value})

    def test_exact_image_and_single_durable_claim(self):
        feed, cover = fixture()
        client = FakeClient()
        fetch = lambda path: json.dumps(feed).encode() if path == 'latest.json' else cover
        with tempfile.TemporaryDirectory() as root:
            journal = bridge.Journal(Path(root))
            bridge.run_once(True, fetch, lambda: client, journal)
            with self.assertRaises(bridge.BridgeError):
                bridge.run_once(True, fetch, lambda: client, journal)
            self.assertEqual(client.calls, ['create', 'queue'])
            record = json.loads(next(Path(root).glob('20*.json')).read_text())
            self.assertEqual(record['state'], 'queued')

    def test_ambiguous_queue_is_never_retried_after_restart(self):
        feed, cover = fixture()
        client = FakeClient(fail=True)
        fetch = lambda path: json.dumps(feed).encode() if path == 'latest.json' else cover
        with tempfile.TemporaryDirectory() as root:
            journal = bridge.Journal(Path(root))
            with self.assertRaises(TimeoutError):
                bridge.run_once(True, fetch, lambda: client, journal)
            with self.assertRaises(bridge.BridgeError):
                bridge.run_once(True, fetch, lambda: client, bridge.Journal(Path(root)))
            self.assertEqual(client.calls, ['create', 'queue'])
            self.assertEqual(json.loads(next(Path(root).glob('20*.json')).read_text())['state'], 'queue-uncertain')

    def test_image_mismatch_and_existing_draft_never_mutate(self):
        feed, cover = fixture()
        client = FakeClient()
        fetch = lambda path: json.dumps(feed).encode() if path == 'latest.json' else cover + b'changed'
        with self.assertRaises(bridge.BridgeError):
            bridge.run_once(True, fetch, lambda: client)
        client.existing = lambda _: True
        with self.assertRaises(bridge.BridgeError):
            bridge.run_once(True, fetch, lambda: client)
        self.assertEqual(client.calls, [])

    def test_verified_feed_does_not_require_or_contact_local_app(self):
        feed, _ = fixture()
        feed['verified_public_url'] = 'https://www.patreon.com/posts/123'
        _, verified = bridge.run_once(True, lambda _: json.dumps(feed).encode(), lambda: self.fail('local app contacted'))
        self.assertTrue(verified)

    def test_account_requires_live_correct_campaign_and_public_folder(self):
        client = object.__new__(bridge.PostyBirb)
        def request(method, path):
            if path == '/account/statuses':
                return [{'_id': 'a', 'website': 'Patreon', 'loggedIn': True}]
            if 'info/' in path:
                return bridge.CAMPAIGN
            return [{'label': 'Everyone', 'value': 'public-rule'}, {'label': 'Patrons Only', 'value': 'paid'}]
        client.request = request
        self.assertEqual(client.account(), ('a', 'public-rule'))
        client.request = lambda method, path: [{'_id': 'a', 'website': 'Patreon', 'loggedIn': False}]
        with self.assertRaises(bridge.BridgeError):
            client.account()

    def test_create_protocol_round_trips_only_public_patreon_part(self):
        feed, cover = fixture()
        client = object.__new__(bridge.PostyBirb)
        captured = {}
        def request(method, path, body=None, content_type=None):
            if path == '/submission/create':
                boundary = content_type.split('boundary=')[1].encode()
                part = next(piece for piece in body.split(b'--' + boundary) if b'name="parts"' in piece)
                parts = json.loads(part.split(b'\r\n\r\n', 1)[1].strip())
                self.assertEqual(len(parts), 1)
                captured['part'] = parts[0]
                self.assertIn(cover, body)
                return {'_id': 'draft123'}
            return {'parts': {'account': captured['part']}, 'hasProblems': False, 'problems': {},
                    'submission': {'schedule': {'isScheduled': False}, 'additional': [],
                                   'primary': {'mimetype': 'image/jpeg', 'size': len(cover)}}}
        client.request = request
        self.assertEqual(client.create(feed, cover, 'account', 'everyone'), 'draft123')
        options = captured['part']['data']
        self.assertEqual(options['tiers'], ['everyone'])
        self.assertFalse(options['charge'])
        package = request('GET', '/submission/draft123')
        for key, value in [('charge', True), ('tiers', ['paid']), ('schedule', 'tomorrow')]:
            changed = copy.deepcopy(package)
            changed['parts']['account']['data'][key] = value
            with self.assertRaises(bridge.BridgeError):
                bridge.verify_package(changed, 'account', options, len(cover))

    def test_tls_pin_is_checked_before_auth_header(self):
        client = object.__new__(bridge.PostyBirb)
        client.token = 'SECRET_TEST_ONLY'
        client.certificate = 'fixture'
        with patch.object(bridge, 'PinnedConnection') as factory:
            connection = factory.return_value
            connection.connect.side_effect = bridge.BridgeError('pin mismatch')
            with self.assertRaises(bridge.BridgeError):
                client.request('GET', '/account/statuses')
            connection.request.assert_not_called()
            connection.close.assert_called_once()

    def test_connection_uses_loopback_and_compares_exact_peer(self):
        pem = ssl_fixture()
        connection = bridge.PinnedConnection(pem)
        peer = MagicMock()
        peer.getpeercert.return_value = b'wrong'
        sock = MagicMock()
        context = MagicMock()
        context.wrap_socket.return_value = peer
        connection._context = context
        with patch.object(bridge.socket, 'create_connection', return_value=sock) as connect:
            with self.assertRaises(bridge.BridgeError):
                connection.connect()
            self.assertEqual(connect.call_args.args[0], ('127.0.0.1', 9247))
            peer.close.assert_called_once()

    def test_html_escapes_generated_text(self):
        self.assertEqual(bridge.post_html('<script>\n&'), '<p>&lt;script&gt;<br />&amp;</p>')


def ssl_fixture():
    # DER parsing is not needed by this socket mock; the pin still compares bytes.
    return '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----'


if __name__ == '__main__':
    unittest.main()
