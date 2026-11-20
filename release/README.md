# npm release train

`publish.yml` follows the parsanol-ts trusted-publishing pattern. Pull requests
prepare, verify, install and dry-run a tarball without OIDC permission. A `vX.Y.Z`
tag, or a manual run on `main` with `publish` selected, can publish that same
verified tarball with provenance. Ordinary branch pushes and merges never publish.
Manual runs default to a dry run. The publishing job uses the `npm` environment.

The rs train lists sibling runtimes in `ukiryu-rs/release/train.json`; its manual
`release-train.yml` builds rs artifacts without dispatching other repositories.
This repository joins that inventory through `release/train.json`. Every npm
candidate checks its membership and common version against rs `main`, and checks
the committed Node/web engines against their exact `vendor/core-pin.json` commit.
The uploaded `release.json` records both source commits, the engine commit and a
`Release X: npm package at ukiryu-rs Y` label. `SHA256SUMS` binds the publish step
to the verified tarball. No engine is rebuilt or silently replaced for publication.

Before the first publish, Ronald must:

1. Approve the v1 API, npm identity and Node floor; update the package, lockfile
   and rs train inventory together if the identity changes.
2. Choose the common train version, set `train_version` in the rs inventory,
   and align package/lockfile and both engines with that version. Set
   `private: false` explicitly in `package.json`; the workflow never changes it.
3. Set up the npm package and register its GitHub trusted publisher with owner
   `ukiryu`, repository `ukiryu-ts`, workflow `publish.yml`, environment `npm`.
   Configure any desired GitHub environment protection. No registry token is used.
4. Approve and perform the first publication via the matching tag or explicit
   manual publish request, after the rs release-train dry run passes.

The current private manifest and undecided train version intentionally block
real publication. A passing PR dry run proves packaging, not registry setup or
publication. First-publish bootstrapping remains the owner's action.

For local workflow checks, install `scripts/requirements-release.txt` in a local
environment, then run `python scripts/shipped-audit.py` and
`python scripts/test-npm-release.py`. Neither command builds or publishes.
