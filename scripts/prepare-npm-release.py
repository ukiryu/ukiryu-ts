#!/usr/bin/env python3
"""Validate the rs train and record the npm candidate's exact core/source.

Dry runs allow the owner's undecided train version and private package.
--publish requires an approved common version and a publishable manifest.
No package metadata is rewritten and no registry is contacted.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(root, train, ref, publish=False):
    pkg = json.loads((root / 'package.json').read_text())
    lock = json.loads((root / 'package-lock.json').read_text())
    pin = json.loads((root / 'vendor/core-pin.json').read_text())
    config = json.loads((root / 'release/train.json').read_text())
    version = pkg['version']
    require(bool(re.fullmatch(r'\d+\.\d+\.\d+', version)), 'train version must be X.Y.Z')
    require(version == lock['version'] == lock['packages']['']['version'], 'lockfile version differs')
    require(pkg['name'] == lock['name'] == lock['packages']['']['name'], 'lockfile package name differs')
    require(pin['repository'] == config['train_repository'], 'engine and release train repositories differ')
    require(bool(re.fullmatch(r'[0-9a-f]{40}', pin['commit'])), 'engine pin must be a full commit SHA')
    members = [a for a in train['artifacts'] if a['id'] == config['artifact']]
    require(len(members) == 1, 'npm artifact must occur exactly once in the rs train')
    member = members[0]
    require(member['repo'] == config['repository'], 'rs train points at a different npm repository')
    require(member['package'] == pkg['name'], 'npm name differs from the rs train')
    require(train['train_version'] in (None, version), 'npm version differs from the rs train')
    for target in ('ukiryu-wasm', 'ukiryu-web'):
        built = json.loads((root / f'vendor/{target}/BUILT_FROM').read_text())
        require(built['core_commit'] == pin['commit'], f'{target} core differs from the pin')
        require(built['crate_version'] == version, f'{target} version differs from the train')
    if ref.startswith('refs/tags/'):
        require(ref == f'refs/tags/v{version}', 'release tag must match the npm version')
    if publish:
        require(ref in ('refs/heads/main', f'refs/tags/v{version}'), 'publish only from main or matching version tag')
        require(pkg.get('private') is False, 'owner must explicitly set private:false before publishing')
        require(train['train_version'] == version, 'owner must set the rs train version before publishing')
    return {
        'schema': 1,
        'package': pkg['name'],
        'version': version,
        'engine_repository': pin['repository'],
        'engine_commit': pin['commit'],
        'train_version': train['train_version'],
        'release': f'Release {version}: npm package at ukiryu-rs {pin["commit"]}',
        'publish_requested': publish,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core', type=Path, required=True)
    parser.add_argument('--ref', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    config = json.loads((ROOT / 'release/train.json').read_text())
    train = json.loads((args.core / config['train_inventory']).read_text())
    try:
        record = validate(ROOT, train, args.ref, args.publish)
    except ValueError as error:
        sys.exit(f'npm release: {error}')
    for label, repo in [('source_commit', ROOT), ('train_commit', args.core)]:
        record[label] = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'release.json').write_text(json.dumps(record, indent=2) + '\n')
    print(record['release'])
    print('release record written; registry publication was not attempted')


if __name__ == '__main__':
    main()
