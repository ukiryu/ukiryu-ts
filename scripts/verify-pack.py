#!/usr/bin/env python3
"""Verify an npm tarball: exact file list, engine hashes, package metadata.

usage: verify-pack.py TARBALL --package-dir DIR
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import tarfile

ap = argparse.ArgumentParser()
ap.add_argument('tarball')
ap.add_argument('--package-dir', default='.')
args = ap.parse_args()
root = pathlib.Path(args.package_dir)


def fail(msg):
    sys.exit(f'verify-pack: FAIL: {msg}')


manifest = json.loads((root / 'package.json').read_text())
members = {}
with tarfile.open(args.tarball) as tar:
    for m in tar.getmembers():
        if m.isfile():
            name = m.name.removeprefix('package/')
            members[name] = tar.extractfile(m).read()

expected = set(subprocess.run(
    ['git', '-C', str(root), 'ls-files', '--', 'dist'],
    check=True, capture_output=True, text=True).stdout.split())
expected |= {'package.json', 'README.md', 'LICENSE'}
for target in ('ukiryu-wasm', 'ukiryu-web'):
    built = json.loads((root / f'vendor/{target}/BUILT_FROM').read_text())
    expected.add(f'vendor/{target}/BUILT_FROM')
    for rel, digest in built['files'].items():
        if rel == '.gitignore':  # left out of the vendor layout on purpose
            continue
        path = f'vendor/{target}/{rel}'
        expected.add(path)
        if path in members and hashlib.sha256(members[path]).hexdigest() != digest:
            fail(f'{path} does not match its BUILT_FROM hash')

got = set(members)
if got != expected:
    fail(f'missing {sorted(expected - got)}, unexpected {sorted(got - expected)}')
packed = json.loads(members['package.json'])
for key in ('name', 'version', 'license', 'exports'):
    if packed.get(key) != manifest.get(key):
        fail(f'packed package.json {key} differs from the repository')
print(f'verify-pack: ok, {len(got)} files, {packed["name"]}@{packed["version"]}')
