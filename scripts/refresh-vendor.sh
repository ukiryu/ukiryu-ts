#!/usr/bin/env bash
# Reproduce the Core WebAssembly vendor workflow from a clean pinned checkout.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
package=$(cd "$(dirname "$0")/.." && pwd)
core=$(cd "${1:?usage: refresh-vendor.sh /path/to/ukiryu-rs}" && pwd)
readarray -t pin < <(python3 - "$package/vendor/core-pin.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
for field in [p['commit'],p['toolchain']['rust'],p['toolchain']['wasm_pack'],p['toolchain']['emscripten']]: print(field)
PY
)
test "$(git -C "$core" rev-parse HEAD)" = "${pin[0]}"
git -C "$core" diff --quiet
git -C "$core" diff --cached --quiet
test -z "$(git -C "$core" ls-files --others --exclude-standard)"
[[ "$(rustc --version)" == "rustc ${pin[1]} "* ]]
test "$(wasm-pack --version)" = "wasm-pack ${pin[2]}"
emcc --version | head -1 | grep -F "${pin[3]}"
(
  cd "$core"
  wasm-pack build ukiryu --target nodejs --out-dir ../wasm-node --no-opt -- --locked --features wasm
  wasm-pack build ukiryu --target web --out-dir ../wasm-web --no-opt -- --locked --features wasm
  cp LICENSE wasm-node/LICENSE
  cp LICENSE wasm-web/LICENSE
  python3 scripts/artifact_licenses.py stage wasm-node wasm-web
  python3 scripts/stamp-wasm-build.py
  python3 scripts/artifact_licenses.py verify --npm wasm-node wasm-web
  python3 scripts/verify-wasm-artifacts.py .
)
python3 - "$core" "$package/vendor" <<'PY'
from pathlib import Path
import shutil,sys
core,vendor=map(Path,sys.argv[1:])
for source,name in [('wasm-node','ukiryu-wasm'),('wasm-web','ukiryu-web')]:
    target=vendor/name
    if target.exists(): shutil.rmtree(target)
    shutil.copytree(core/source,target)
    (target/'.gitignore').unlink(missing_ok=True)
PY
python3 "$package/scripts/verify-vendor.py" "$package/vendor" --core "$core" --commit "${pin[0]}" --track HEAD
