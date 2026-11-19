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
            'title': "Pack One's Contested Daily Pick " + day,
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


class DraftApp:
    """Source-derived PostyBirb contract: creation adds an unrated default part."""
    def __init__(self, root, feed, cover):
        self.image = root / 'stored.jpg'
        self.image.write_bytes(cover)
        self.cover = cover
        self.feed = feed
        self.calls = []
        self.logs = []
        self.multiple = False
        self.fail_patch = False
        self.fail_queue = False
        self.created_parts = []
        self.package = {'parts': {
            'default': {'accountId': 'default', 'website': 'default', 'isDefault': True,
                        'data': {'title': 'featured-cover', 'description': {'value': '', 'overwriteDefault': False}},
                        'postStatus': 'UNPOSTED'},
            'account': {'accountId': 'account', 'website': 'Patreon', 'isDefault': False,
                        'data': bridge.patreon_options(feed, 'everyone'), 'postStatus': 'UNPOSTED'}},
            'submission': {'_id': 'draft123', 'type': 'FILE', 'isPosting': False, 'isQueued': False,
                           'schedule': {}, 'additional': [],
                           'primary': {'mimetype': 'image/jpeg', 'size': len(cover), 'location': str(self.image)}},
            'problems': {}, 'hasProblems': False}
        self.validate()

    def validate(self):
        errors = [] if self.package['parts']['default']['data'].get('rating') else ['Please provide a rating.']
        self.package['problems'] = {'default': {'problems': errors}}
        self.package['hasProblems'] = bool(errors)

    def client(self):
        client = object.__new__(bridge.PostyBirb)
        client.request = self.request
        client.account = lambda: ('account', 'everyone')
        return client

    def request(self, method, path, body=None, content_type=None):
        if path == '/submission-log/FILE':
            return self.logs
        if path == '/submission?type=FILE&packaged=true':
            return [copy.deepcopy(self.package)] * (2 if self.multiple else 1)
        if path == '/submission/draft123?packaged=true':
            return copy.deepcopy(self.package)
        if path == '/submission/create':
            self.calls.append('create')
            boundary = content_type.split('boundary=')[1].encode()
            piece = next(p for p in body.split(b'--' + boundary) if b'name="parts"' in p)
            parts = json.loads(piece.split(b'\r\n\r\n', 1)[1].strip())
            self.created_parts = [p['accountId'] for p in parts]
            for part in parts:
                self.package['parts'][part['accountId']] = {**part, 'postStatus': 'UNPOSTED'}
            self.validate()
            assert self.cover in body
            return {'_id': 'draft123'}
        if method == 'PATCH' and path == '/submission/update':
            self.calls.append('patch')
            assert body['id'] == 'draft123' and body['removedParts'] == []
            assert len(body['parts']) == 1 and body['parts'][0]['accountId'] == 'default'
            original = self.package['parts']['default']
            expected = {**original, 'data': {**original['data'], 'rating': 'general'}}
            assert body['parts'][0] == expected
            self.package['parts']['default'] = body['parts'][0]
            self.validate()
            if self.fail_patch:
                raise TimeoutError('rating update response lost')
            return copy.deepcopy(self.package)
        if path == '/post/queue/draft123':
            self.calls.append('queue')
            assert not self.package['hasProblems']
            if self.fail_queue:
                raise TimeoutError('queue response lost')
            return None
        raise AssertionError('Unexpected local request')


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

    def test_title_wording_can_change_without_losing_date_provenance(self):
        feed, _ = fixture()
        day = feed['feature_day']
        for title in ["Pack One's Contested Daily Pick " + day,
                      'Legacy headline | Pack One Daily ' + day,
                      'Pack One draft discussion ' + day]:
            bridge.validate_feed({**feed, 'title': title})
        for title in ['Missing date', "Pack One's Contested Daily Pick 2000-01-01",
                      day + ' and 2026-01-01']:
            with self.assertRaises(bridge.BridgeError):
                bridge.validate_feed({**feed, 'title': title})

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

    def test_create_sets_both_required_ratings_and_validates_stored_image(self):
        feed, cover = fixture()
        with tempfile.TemporaryDirectory() as root:
            app = DraftApp(Path(root), feed, cover)
            client = app.client()
            self.assertEqual(client.create(feed, cover, 'account', 'everyone'), 'draft123')
            self.assertEqual(app.created_parts, ['default', 'account'])
            self.assertEqual(app.package['parts']['default']['data']['rating'], 'general')
            self.assertEqual(app.package['parts']['account']['data']['rating'], 'general')
            self.assertFalse(app.package['hasProblems'])
            options = bridge.patreon_options(feed, 'everyone')
            for key, value in [('charge', True), ('tiers', ['paid']), ('schedule', 'tomorrow')]:
                changed = copy.deepcopy(app.package)
                changed['parts']['account']['data'][key] = value
                with self.assertRaises(bridge.BridgeError):
                    bridge.verify_package(changed, 'account', options, len(cover))

    def test_validator_reproduces_reported_missing_default_rating(self):
        feed, cover = fixture()
        with tempfile.TemporaryDirectory() as root:
            app = DraftApp(Path(root), feed, cover)
            self.assertTrue(app.package['hasProblems'])
            self.assertEqual(app.package['problems']['default']['problems'], ['Please provide a rating.'])
            with self.assertRaises(bridge.BridgeError):
                bridge.verify_package(app.package, 'account', bridge.patreon_options(feed, 'everyone'), len(cover))

    def test_recovers_the_original_never_queued_draft_without_duplicate_creation(self):
        feed, cover = fixture()
        with tempfile.TemporaryDirectory() as root:
            app = DraftApp(Path(root), feed, cover)
            journal = bridge.Journal(Path(root) / 'journal')
            journal.claim(feed)  # Original helper stopped during validation.
            fetch = lambda path: json.dumps(feed).encode() if path == 'latest.json' else cover
            bridge.run_once(True, fetch, app.client, journal)
            self.assertEqual(app.calls, ['patch', 'queue'])
            self.assertEqual(app.package['submission']['_id'], 'draft123')
            self.assertEqual(app.package['parts']['default']['data']['rating'], 'general')
            with self.assertRaises(bridge.BridgeError):
                bridge.run_once(True, fetch, app.client, bridge.Journal(Path(root) / 'journal'))
            self.assertEqual(app.calls, ['patch', 'queue'])

    def test_recovery_refuses_changed_attempted_or_ambiguous_drafts_before_mutation(self):
        feed, cover = fixture()
        scenarios = ['queued', 'posting', 'failed', 'paid', 'other-error', 'changed-image', 'prior-log', 'multiple', 'mature']
        for scenario in scenarios:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as root:
                app = DraftApp(Path(root), feed, cover)
                if scenario == 'queued':
                    app.package['submission']['isQueued'] = True
                elif scenario == 'posting':
                    app.package['submission']['isPosting'] = True
                elif scenario == 'failed':
                    app.package['parts']['account']['postStatus'] = 'FAILED'
                elif scenario == 'paid':
                    app.package['parts']['account']['data']['charge'] = True
                elif scenario == 'other-error':
                    app.package['problems']['account'] = {'problems': ['Other validation problem.']}
                elif scenario == 'changed-image':
                    app.image.write_bytes(b'changed')
                elif scenario == 'prior-log':
                    app.logs.append({'parts': [{'part': copy.deepcopy(app.package['parts']['account'])}]})
                elif scenario == 'multiple':
                    app.multiple = True
                elif scenario == 'mature':
                    app.package['parts']['default']['data']['rating'] = 'mature'
                journal = bridge.Journal(Path(root) / 'journal')
                journal.claim(feed)
                fetch = lambda path: json.dumps(feed).encode() if path == 'latest.json' else cover
                with self.assertRaises(bridge.BridgeError):
                    bridge.run_once(True, fetch, app.client, journal)
                self.assertEqual(app.calls, [])

    def test_rating_patch_timeout_can_resume_but_queue_timeout_cannot(self):
        feed, cover = fixture()
        with tempfile.TemporaryDirectory() as root:
            app = DraftApp(Path(root), feed, cover)
            app.fail_patch = True
            journal = bridge.Journal(Path(root) / 'journal')
            journal.claim(feed)
            fetch = lambda path: json.dumps(feed).encode() if path == 'latest.json' else cover
            with self.assertRaises(TimeoutError):
                bridge.run_once(True, fetch, app.client, journal)
            self.assertEqual(app.calls, ['patch'])
            app.fail_patch = False
            app.fail_queue = True
            with self.assertRaises(TimeoutError):
                bridge.run_once(True, fetch, app.client, journal)
            with self.assertRaises(bridge.BridgeError):
                bridge.run_once(True, fetch, app.client, journal)
            self.assertEqual(app.calls, ['patch', 'queue'])

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
