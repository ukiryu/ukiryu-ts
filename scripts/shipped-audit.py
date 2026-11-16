#!/usr/bin/env python3
"""Shipped audit for the npm package, without network or publishing.

Checks that no workflow can publish or hold credentials, and that the package
version, lockfile and vendored engine build records agree.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
errors = []


def check(ok, msg):
    if not ok:
        errors.append(msg)
    print(('ok    ' if ok else 'FAIL  ') + msg)


pkg = json.loads((ROOT / 'package.json').read_text())
lock = json.loads((ROOT / 'package-lock.json').read_text())
pin = json.loads((ROOT / 'vendor/core-pin.json').read_text())

check(pkg['version'] == lock['version'] == lock['packages']['']['version'],
      f"package.json, package-lock.json versions agree ({pkg['version']})")
check(pkg.get('private') is True, 'package.json is private (first publication is the owner\'s)')
check('publishConfig' not in pkg, 'package.json has no publishConfig')
check(not any(k in pkg.get('scripts', {}) for k in ('publish', 'prepublish', 'prepublishOnly', 'postpublish')),
      'no publish lifecycle scripts')
for target in ('ukiryu-wasm', 'ukiryu-web'):
    built = json.loads((ROOT / f'vendor/{target}/BUILT_FROM').read_text())
    check(built['core_commit'] == pin['commit'], f'{target} built from the pinned core commit')
    check(built['crate_version'] == pkg['version'], f"{target} crate version equals package version ({built['crate_version']})")
    vp = json.loads((ROOT / f'vendor/{target}/package.json').read_text())
    check(vp['version'] == pkg['version'], f'{target}/package.json version equals package version')

forbidden = re.compile(r'\b(?:npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|gh\s+release\s+create|git\s+tag|git\s+push)\b')
for wf in sorted((ROOT / '.github/workflows').glob('*.yml')):
    text = wf.read_text()
    check(not forbidden.search(text), f'{wf.name} has no publish, tag or release command')
    check('secrets.' not in text, f'{wf.name} uses no secrets')
    check(not re.search(r'(contents|id-token|packages):\s*write', text), f'{wf.name} requests no write permission')
    check('NODE_AUTH_TOKEN' not in text and 'NPM_TOKEN' not in text, f'{wf.name} names no npm token')

print()
if errors:
    print(f'{len(errors)} shipped-audit check(s) failed')
    sys.exit(1)
print('shipped audit passed')
