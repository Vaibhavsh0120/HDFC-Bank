import unittest

from release_tools import build_source, release_notes


def release(version, *, ios=True, **extras):
    return {'tag_name': 'v' + version, 'published_at': '2026-11-04T08:00:00Z', 'body': 'Future release details',
            'assets': [{'name': f'HDFC-Bank-{version}-ios-unsigned.ipa', 'size': 123, 'browser_download_url': 'https://example.test/app.ipa'}] if ios else [], **extras}


class ReleaseTests(unittest.TestCase):
    def test_changelog_has_every_published_version_and_separate_notes(self):
        for version in ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.4.1', '1.4.2', '1.5.0']:
            self.assertTrue(release_notes(version))
        self.assertIn('native camera', release_notes('1.4.2'))
        self.assertNotIn('## 1.4.1', release_notes('1.4.2'))
        self.assertIsNone(release_notes('9.0.0'))

    def test_source_uses_newest_actual_ipa_and_semver_sorting(self):
        source = build_source([release('1.4.2'), release('1.10.0'), release('1.5.0'), release('2.0.0', ios=False), release('3.0.0', draft=True), release('4.0.0', prerelease=True)])
        app = source['apps'][0]
        self.assertEqual([v['version'] for v in app['versions']], ['1.10.0', '1.5.0', '1.4.2'])
        self.assertEqual(app['version'], '1.10.0')
        self.assertEqual(app['versions'][0]['buildVersion'], '1010000')
        self.assertEqual(app['versions'][0]['localizedDescription'], 'Future release details')
        self.assertEqual(app['size'], 123)

    def test_empty_source_refused(self):
        with self.assertRaises(ValueError):
            build_source([release('1.5.0', ios=False)])


if __name__ == '__main__':
    unittest.main()
