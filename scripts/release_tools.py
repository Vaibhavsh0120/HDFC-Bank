"""Release notes and an AltStore-compatible LiveContainer source (stdlib only)."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'Vaibhavsh0120/HDFC-Bank'
SOURCE_BRANCH = 'livecontainer'
SOURCE_URL = f'https://raw.githubusercontent.com/{REPOSITORY}/{SOURCE_BRANCH}/apps.json'


def release_notes(version):
    text = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    match = re.search(r'^## ' + re.escape(version) + r' [^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
    return match[1].strip() if match else None


def build_source(releases):
    versions = []
    for release in releases:
        tag = release['tag_name']
        if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
            continue
        version = tag[1:]
        ipa = next((a for a in release.get('assets', []) if a['name'] == f'HDFC-Bank-{version}-ios-unsigned.ipa' and a['size'] > 0), None)
        if not ipa:
            continue
        versions.append({
            'version': version, 'buildVersion': str(sum(int(n) * factor for n, factor in zip(version.split('.'), [1000000, 1000, 1]))),
            'date': release['published_at'], 'localizedDescription': release_notes(version) or release.get('body', ''),
            'downloadURL': ipa['browser_download_url'], 'size': ipa['size'], 'minOSVersion': '15.0',
        })
    versions.sort(key=lambda row: tuple(map(int, row['version'].split('.'))), reverse=True)
    if not versions:
        raise ValueError('No published iOS IPA assets found; refusing to publish an empty source.')
    latest = versions[0]
    return {
        'name': 'HDFC Bank · Student Project', 'identifier': 'dev.vaibhavsh0120.hdfcbank.source',
        'sourceURL': SOURCE_URL, 'website': f'https://github.com/{REPOSITORY}',
        'subtitle': 'Fictional banking for learning and demonstration',
        'description': 'The official project source for HDFC Bank. Fictional funds; independent of the real bank. Unsigned iOS packages for a compatible LiveContainer setup.',
        'tintColor': '#132A57', 'iconURL': f'https://raw.githubusercontent.com/{REPOSITORY}/main/frontend/public/apple-touch-icon.png',
        'apps': [{
            'name': 'HDFC Bank', 'bundleIdentifier': 'dev.vaibhavsh0120.hdfcbank', 'developerName': 'Vaibhav Sharma, Aashi Agarwal & Yashika Pachori',
            'subtitle': 'A student banking simulator', 'localizedDescription': 'Manage fictional savings, internal transfers, QR payments and demo virtual cards. This is an independent student project, not a real bank.',
            'iconURL': f'https://raw.githubusercontent.com/{REPOSITORY}/main/frontend/public/apple-touch-icon.png',
            'tintColor': '#132A57', 'versions': versions,
            # Legacy source readers still expect the latest version on the app itself.
            'version': latest['version'], 'versionDate': latest['date'], 'versionDescription': latest['localizedDescription'],
            'downloadURL': latest['downloadURL'], 'size': latest['size'], 'minOSVersion': '15.0',
            'appPermissions': {'entitlements': [], 'privacy': [
                {'name': 'NSCameraUsageDescription', 'usageDescription': 'Allow camera access to scan an account QR code.'},
                {'name': 'NSFaceIDUsageDescription', 'usageDescription': 'Use Face ID to unlock your account when device unlock is enabled.'},
            ]},
        }], 'news': [],
    }


class GitHub:
    def __init__(self, git_credentials=False):
        self.token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        if git_credentials and not self.token:
            result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True)
            self.token = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line).get('password')

    def api(self, path, method='GET', data=None):
        if method != 'GET' and not self.token:
            raise ValueError('A GitHub token is required for publishing.')
        headers = {'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'hdfc-bank-release-tools', 'X-GitHub-Api-Version': '2022-11-28'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + '/' + path, method=method, headers=headers,
                                         data=json.dumps(data).encode() if data is not None else None)
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def releases(self):
        rows, page = [], 1
        while True:
            batch = self.api(f'releases?per_page=100&page={page}')
            rows.extend(batch)
            if len(batch) < 100:
                return rows
            page += 1

    def publish_source(self, source):
        try:
            self.api('git/ref/heads/' + SOURCE_BRANCH)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            main = self.api('git/ref/heads/main')
            self.api('git/refs', 'POST', {'ref': 'refs/heads/' + SOURCE_BRANCH, 'sha': main['object']['sha']})
        content = (json.dumps(source, indent=2, ensure_ascii=False) + '\n').encode()
        body = {'message': f"Update LiveContainer source to {source['apps'][0]['version']}", 'branch': SOURCE_BRANCH, 'content': base64.b64encode(content).decode()}
        try:
            current = self.api('contents/apps.json?ref=' + SOURCE_BRANCH)
            if base64.b64decode(current['content']) == content:
                print('LiveContainer source already current.')
                return
            body['sha'] = current['sha']
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        self.api('contents/apps.json', 'PUT', body)
        print('Published LiveContainer source:', SOURCE_URL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['notes', 'backfill', 'source'])
    parser.add_argument('--version')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--git-credentials', action='store_true', help='Use the configured Git credential helper without writing credentials to disk.')
    args = parser.parse_args()
    if args.command == 'notes':
        if not args.version or not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
            parser.error('notes requires --version MAJOR.MINOR.PATCH')
        notes = release_notes(args.version)
        if notes is None:
            raise SystemExit(2)  # Workflow falls back to GitHub-generated commit notes.
        notes += '\n\nAndroid APKs use the project release key. The iOS IPA is unsigned; use a compatible signing or LiveContainer setup. Fictional funds only.\n'
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(notes, encoding='utf-8')
        else:
            print(notes)
        return
    github = GitHub(args.git_credentials)
    releases = github.releases()
    if args.command == 'backfill':
        for release in releases:
            version = release['tag_name'].removeprefix('v')
            notes = release_notes(version)
            if not notes or release.get('draft'):
                continue
            signing = 'debug-signed' if version == '1.0.0' else 'signed with the project release key'
            body = notes + f'\n\nAndroid APK: {signing}. The iOS IPA is unsigned and requires a compatible signing or LiveContainer setup. Fictional funds only.\n'
            if args.publish:
                github.api(f"releases/{release['id']}", 'PATCH', {'body': body})
            print(('Updated ' if args.publish else 'Would update ') + release['tag_name'])
    else:
        source = build_source(releases)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(source, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        if args.publish:
            github.publish_source(source)
        print(f"Source includes {len(source['apps'][0]['versions'])} published iOS versions; latest {source['apps'][0]['version']}.")


if __name__ == '__main__':
    main()
