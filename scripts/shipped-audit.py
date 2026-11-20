#!/usr/bin/env python3
"""Shipped audit for the npm package, without network or publishing.

Checks that only the tag/manual npm job can publish, no workflow uses stored
credentials, and package/lockfile/engine versions agree.
"""
import json
import pathlib
import re
import sys
import yaml

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
check(isinstance(pkg.get('private'), bool), 'package.json explicitly declares its publication status')
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
    if wf.name == 'publish.yml':
        # BaseLoader preserves the YAML `on` key rather than interpreting it
        # as the YAML 1.1 boolean True. All scalar values are strings.
        workflow = yaml.load(text, Loader=yaml.BaseLoader)
        triggers = workflow['on']
        check(set(triggers) == {'pull_request', 'push', 'workflow_dispatch'}, 'npm workflow has only PR, tag and manual triggers')
        check(triggers['push'] == {'tags': ['v*']}, 'npm push trigger accepts version tags only')
        check(triggers['workflow_dispatch']['inputs']['publish']['default'] == 'false', 'manual runs default to a dry run')
        check(workflow['permissions'] == {'contents': 'read'}, 'npm workflow defaults to read-only permissions')
        jobs = workflow['jobs']
        check(set(jobs) == {'candidate', 'publish'}, 'npm workflow has only candidate and publish jobs')
        publish = jobs['publish']
        guard = ' '.join(publish['if'].split())
        check(guard == "(github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')) || "
              "(github.event_name == 'workflow_dispatch' && inputs.publish && github.ref == 'refs/heads/main')",
              'npm publication excludes PRs and requires a tag or explicit manual request on main')
        check(publish['needs'] == 'candidate' and publish['environment'] == 'npm', 'publication requires the candidate and npm environment')
        check(publish['permissions'] == {'contents': 'read', 'id-token': 'write'}, 'only npm publication requests OIDC permission')
        check('permissions' not in jobs['candidate'], 'candidate inherits read-only permissions')
        check(text.count('id-token: write') == 1, 'one OIDC grant in the publishing job')
        allowed = (
            'npm publish "$RUNNER_TEMP"/npm-release/*.tgz --dry-run --ignore-scripts --access public',
            'npm publish ./*.tgz --access public --provenance --ignore-scripts',
        )
        commands = [line.strip() for line in text.splitlines() if forbidden.search(line)]
        check(commands == list(allowed), 'only the candidate dry run and provenance publish commands are allowed')
        check('--publish' in (ROOT / 'scripts/prepare-npm-release.py').read_text(), 'publication has a release metadata guard')
    else:
        check(not forbidden.search(text), f'{wf.name} has no publish, tag or release command')
        check(not re.search(r'(contents|id-token|packages):\s*write', text), f'{wf.name} requests no write permission')
    check('secrets.' not in text, f'{wf.name} uses no secrets')
    check('NODE_AUTH_TOKEN' not in text and 'NPM_TOKEN' not in text, f'{wf.name} names no npm token')

print()
if errors:
    print(f'{len(errors)} shipped-audit check(s) failed')
    sys.exit(1)
print('shipped audit passed')
