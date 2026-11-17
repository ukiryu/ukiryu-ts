#!/usr/bin/env python3
"""Verify the vendored core engines against BUILT_FROM and the core source.

Checks, for vendor/ukiryu-wasm (wasm-pack nodejs) and vendor/ukiryu-web
(wasm-pack web):

- BUILT_FROM names the pinned core commit and a well-formed lock hash;
- the delivered files are exactly the files BUILT_FROM lists, plus BUILT_FROM,
  and every file has the listed sha256. The one exception is wasm-pack's
  `.gitignore` (`*`): it is a version-control hint, not engine content, and
  npm applies it inside a dependency directory, which would drop the engine
  from the package. The vendor layout leaves it out; if present it must
  still match its hash;
- the lock hash, crate version, LICENSE and Onigmo notices equal the core
  source at that commit (read with git from a core checkout);
- with --track, the commit is an ancestor of that ref of the core checkout
  (the freshness rule: ancestor, not exact head, so merge commits pass).
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

TARGETS = ('ukiryu-wasm', 'ukiryu-web')
ONIGMO = ('NOTICE', 'LEGAL', 'COPYING', 'BSDL', 'PROVENANCE')
REQUIRED = {'LICENSE', 'package.json', 'ukiryu.js', 'ukiryu.d.ts', 'ukiryu_bg.wasm',
            'ukiryu_bg.wasm.d.ts'} | {f'licenses/onigmo/{name}' for name in ONIGMO}
# Listed in BUILT_FROM but left out of the vendor layout (see above).
OMITTED = {'.gitignore'}


def fail(message):
    print(f'verify-vendor: FAIL: {message}', file=sys.stderr)
    sys.exit(1)


def git(core, *args):
    return subprocess.check_output(['git', '-C', str(core), *args])


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('vendor', type=Path)
    parser.add_argument('--core', type=Path, required=True, help='ukiryu-rs checkout with the commit')
    parser.add_argument('--commit', required=True, help='the pinned core commit')
    parser.add_argument('--track', help='core ref the commit must be an ancestor of')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.commit):
        fail(f'pin is not a full commit SHA: {args.commit!r}')

    lock = sha256(git(args.core, 'show', f'{args.commit}:Cargo.lock'))
    manifest = git(args.core, 'show', f'{args.commit}:Cargo.toml').decode()
    version = re.search(r'^\[workspace\.package\][^\[]*?^version\s*=\s*"([^"]+)"', manifest, re.M | re.S)
    if not version:
        fail('core workspace version not found')
    license_bytes = git(args.core, 'show', f'{args.commit}:LICENSE')
    notices = {name: git(args.core, 'show', f'{args.commit}:ukiryu/vendor/onigmo/{name}') for name in ONIGMO}

    for target in TARGETS:
        folder = args.vendor / target
        if not folder.is_dir():
            fail(f'{folder} is missing')
        marker = json.loads((folder / 'BUILT_FROM').read_text(encoding='utf-8'))
        if marker.get('core_commit') != args.commit:
            fail(f'{target}: BUILT_FROM core_commit {marker.get("core_commit")} is not the pin {args.commit}')
        if marker.get('lock_sha256') != lock:
            fail(f'{target}: BUILT_FROM lock_sha256 differs from Cargo.lock at {args.commit}')
        if marker.get('crate_version') != version.group(1):
            fail(f'{target}: BUILT_FROM crate_version {marker.get("crate_version")} is not {version.group(1)}')
        for key in ('rust', 'wasm_pack', 'wasm_bindgen'):
            if not isinstance(marker.get(key), str) or not marker[key]:
                fail(f'{target}: BUILT_FROM has no {key}')
        files = marker.get('files', {})
        if not REQUIRED <= files.keys():
            fail(f'{target}: BUILT_FROM lacks {sorted(REQUIRED - files.keys())}')
        actual = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()}
        listed = set(files) | {'BUILT_FROM'}
        if not (listed - OMITTED) <= actual <= listed:
            fail(f'{target}: delivered files differ from BUILT_FROM: '
                 f'extra {sorted(actual - listed)}, missing {sorted(listed - OMITTED - actual)}')
        for name, digest in files.items():
            path = folder / name
            if name in OMITTED and not path.exists():
                continue
            if not path.resolve().is_relative_to(folder.resolve()):
                fail(f'{target}: {name} escapes the vendor directory')
            if sha256(path.read_bytes()) != digest:
                fail(f'{target}: {name} sha256 differs from BUILT_FROM')
        if (folder / 'LICENSE').read_bytes() != license_bytes:
            fail(f'{target}: LICENSE differs from the core LICENSE at {args.commit}')
        for name, data in notices.items():
            if (folder / 'licenses' / 'onigmo' / name).read_bytes() != data:
                fail(f'{target}: Onigmo {name} differs from the core source at {args.commit}')
        omitted = sorted(name for name in files if name not in actual)
        print(f'{target}: {len(files) - len(omitted)} files match BUILT_FROM at {args.commit}'
              + (f' (omitted: {", ".join(omitted)})' if omitted else ''))

    if args.track:
        result = subprocess.run(['git', '-C', str(args.core), 'merge-base', '--is-ancestor', args.commit, args.track])
        if result.returncode != 0:
            fail(f'{args.commit} is not an ancestor of {args.track}; re-vendor from the tracked core')
        print(f'freshness: {args.commit[:12]} is an ancestor of {args.track} '
              f'({git(args.core, "rev-parse", args.track).decode().strip()[:12]})')


if __name__ == '__main__':
    main()
