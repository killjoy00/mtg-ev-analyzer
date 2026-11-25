import base64
import hashlib
import importlib.util
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).parents[1] / 'scripts' / 'patreon-desktop'
sys.path.insert(0, str(ROOT))
try:
    spec = importlib.util.spec_from_file_location('weekly_private_bridge_fixture', ROOT / 'weekly_private_bridge.py')
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
finally:
    sys.path.remove(str(ROOT))

IMAGE = b'\xff\xd8\xff' + b'x' * 6000
POST = {'title': 'Pack One Weekly | 2026-11-29',
        'body': 'Play Pack One: https://packone.pro/\nDownload on the App Store: https://apps.apple.com/app/id6814318676\nGet it on Google Play: https://play.google.com/store/apps/details?id=pro.packone.app',
        'image_sha256': hashlib.sha256(IMAGE).hexdigest()}
FLAGS = {'PACKONE_WEEKLY_PRIVATE_RUNTIME': 'true',
         'PACKONE_WEEKLY_PUBLICATION_ENABLED': 'true',
         'PACKONE_WEEKLY_NOTICE_VERIFIED': 'true'}

class WeeklyPrivateBridgeTests(unittest.TestCase):
    def test_private_environment_is_explicit_and_ci_is_denied(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(bridge.allowed_environment())
        with patch.dict(os.environ, FLAGS, clear=True):
            self.assertTrue(bridge.allowed_environment())
            with patch.dict(os.environ, {'CI': 'true'}):
                self.assertFalse(bridge.allowed_environment())

    def test_recap_caption_contains_actual_allowed_hyperlinks(self):
        markup = bridge.patreon_options(POST, 'everyone')['description']['value']
        self.assertIn('<a href="https://packone.pro/">Play Pack One</a>', markup)
        self.assertIn('<a href="https://apps.apple.com/app/id6814318676">Download on the App Store</a>', markup)
        self.assertIn('<a href="https://play.google.com/store/apps/details?id=pro.packone.app">Get it on Google Play</a>', markup)
        unsafe = {**POST, 'body': 'Play Pack One: https://evil.example/'}
        self.assertNotIn('<a href=', bridge.patreon_options(unsafe, 'everyone')['description']['value'])

    def test_season_titles_and_source_allowlist(self):
        for title in ('Pack One Season Results & Awards | Fixture Set', 'Pack One Midseason Set Guide | Fixture Set'):
            feed = {**POST, 'title': title}
            self.assertEqual(bridge.valid_payload(feed)['title'], title)
            source = 'https://www.17lands.com/deck_color_data?expansion=TRK&format=PremierDraft&time_period=ALL_TIME&separate_splashes=true'
            feed['body'] += '\n17Lands source: ' + source
            markup = bridge.patreon_options(feed, 'everyone')['description']['value']
            self.assertIn('>17Lands source</a>', markup)
            self.assertIn('>Play Pack One</a>', markup)
            feed['body'] = feed['body'].replace('www.17lands.com', 'evil.example')
            self.assertNotIn('>17Lands source</a>', bridge.patreon_options(feed, 'everyone')['description']['value'])
        with self.assertRaises(Exception):
            bridge.valid_payload({**POST, 'title': 'Pack One Season Results & Awards | Fixture\nOther'})

    def test_stage_does_not_queue_or_allow_mismatched_art(self):
        client = Mock()
        client.account.return_value = ('fixture-account', 'everyone')
        client.existing.return_value = False
        client.create.return_value = 'fixture-draft'
        data = {**POST, 'action': 'stage', 'image_b64': base64.b64encode(IMAGE).decode()}
        self.assertEqual(bridge.handle(data, client), {'id': 'fixture-draft'})
        client.create.assert_called_once_with(POST, IMAGE, 'fixture-account', 'everyone')
        client.request.assert_not_called()
        with self.assertRaises(Exception):
            bridge.handle({**data, 'image_sha256': '0' * 64}, client)
        self.assertEqual(client.create.call_count, 1)

    def test_queue_rechecks_exact_draft_before_single_submission(self):
        client = Mock()
        client.account.return_value = ('fixture-account', 'everyone')
        client.history.return_value = (False, [{'submission': {'_id': 'fixture-draft'}}])
        package = {'synthetic': True}
        client.request.side_effect = [package, None]
        data = {**POST, 'action': 'queue', 'id': 'fixture-draft', 'image_size': len(IMAGE)}
        with patch.object(bridge, 'verify_package') as verify, patch.object(bridge, 'verify_draft_image') as verify_image:
            self.assertEqual(bridge.handle(data, client), {'queued': True})
            verify.assert_called_once()
            verify_image.assert_called_once_with(package, POST['image_sha256'])
        self.assertEqual([call.args[:2] for call in client.request.call_args_list],
                         [('GET', '/submission/fixture-draft?packaged=true'), ('POST', '/post/queue/fixture-draft')])
        client.history.return_value = (True, [])
        with self.assertRaises(Exception):
            bridge.handle(data, client)
        self.assertEqual(client.request.call_count, 2)

if __name__ == '__main__':
    unittest.main()
