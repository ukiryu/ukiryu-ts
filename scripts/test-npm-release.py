#!/usr/bin/env python3
"""Focused release guard regressions; no builds, registry access or corpus."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('release', Path(__file__).with_name('prepare-npm-release.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('package.json', 'package-lock.json', 'release/train.json', 'vendor/core-pin.json',
                     'vendor/ukiryu-wasm/BUILT_FROM', 'vendor/ukiryu-web/BUILT_FROM'):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((release.ROOT / name).read_bytes())
        self.pkg = json.loads((self.root / 'package.json').read_text())
        self.pkg['private'] = True
        self.write('package.json', self.pkg)
        self.version = self.pkg['version']
        self.train = {'train_version': None, 'artifacts': [{
            'id': 'npm-package', 'repo': 'ukiryu/ukiryu-ts', 'package': self.pkg['name'],
        }]}

    def write(self, name, data):
        (self.root / name).write_text(json.dumps(data))

    def approve(self):
        self.pkg['private'] = False
        self.write('package.json', self.pkg)
        self.train['train_version'] = self.version

    def test_pr_dry_run_accepts_private_undecided_train(self):
        record = release.validate(self.root, self.train, 'refs/pull/9/merge')
        self.assertFalse(record['publish_requested'])
        self.assertIn(json.loads((self.root / 'vendor/core-pin.json').read_text())['commit'], record['release'])

    def test_private_package_blocks_publication(self):
        with self.assertRaisesRegex(ValueError, 'private:false'):
            release.validate(self.root, self.train, 'refs/heads/main', True)

    def test_undecided_train_blocks_publication(self):
        self.approve()
        self.train['train_version'] = None
        with self.assertRaisesRegex(ValueError, 'set the rs train version'):
            release.validate(self.root, self.train, 'refs/heads/main', True)

    def test_only_main_or_matching_tag_can_publish(self):
        self.approve()
        for ref in ('refs/heads/topic', 'refs/pull/9/merge', 'refs/tags/v9.9.9'):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                release.validate(self.root, self.train, ref, True)
        for ref in ('refs/heads/main', f'refs/tags/v{self.version}'):
            self.assertTrue(release.validate(self.root, self.train, ref, True)['publish_requested'])

    def test_train_version_and_identity_must_match(self):
        bad = copy.deepcopy(self.train)
        bad['train_version'] = '99.0.0'
        with self.assertRaisesRegex(ValueError, 'version differs'):
            release.validate(self.root, bad, 'refs/pull/9/merge')
        bad = copy.deepcopy(self.train)
        bad['artifacts'][0]['package'] = 'different-name'
        with self.assertRaisesRegex(ValueError, 'name differs'):
            release.validate(self.root, bad, 'refs/pull/9/merge')

    def test_engine_drift_blocks_candidate(self):
        name = 'vendor/ukiryu-web/BUILT_FROM'
        built = json.loads((self.root / name).read_text())
        built['core_commit'] = '0' * 40
        self.write(name, built)
        with self.assertRaisesRegex(ValueError, 'core differs'):
            release.validate(self.root, self.train, 'refs/pull/9/merge')


if __name__ == '__main__':
    unittest.main()
