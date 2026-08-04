#!/bin/zsh

# Verifies that a signed macOS bundle can start its Node.js sidecar and serve health.

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  print -u2 "Usage: $0 /path/to/BookCafe.app"
  exit 64
fi

readonly app_path="${1:A}"
readonly sidecar_path="${app_path}/Contents/MacOS/bookcafe-server"

if [[ ! -x "${sidecar_path}" ]]; then
  print -u2 "Bundled BookCafe sidecar is not executable: ${sidecar_path}"
  exit 66
fi

readonly required_entitlements=(
  "com.apple.security.cs.allow-jit"
  "com.apple.security.cs.allow-unsigned-executable-memory"
  "com.apple.security.cs.disable-library-validation"
)
readonly signed_entitlements="$(codesign -d --entitlements :- "${sidecar_path}" 2>&1)"
typeset entitlement

for entitlement in "${required_entitlements[@]}"; do
  if [[ "${signed_entitlements}" != *"<key>${entitlement}</key>"* ]]; then
    print -u2 "Bundled sidecar is missing entitlement: ${entitlement}"
    exit 65
  fi
done

typeset smoke_dir=""
typeset sidecar_pid=""

cleanup() {
  if [[ -n "${sidecar_pid}" ]]; then
    kill "${sidecar_pid}" >/dev/null 2>&1 || true
    wait "${sidecar_pid}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${smoke_dir}" && -d "${smoke_dir}" ]]; then
    find "${smoke_dir}" -depth -delete
  fi
}

trap cleanup EXIT

smoke_dir="$(mktemp -d "${TMPDIR:-/tmp}/bookcafe-bundle-smoke.XXXXXX")"
readonly config_path="${smoke_dir}/config.json"
readonly state_dir="${smoke_dir}/state"
readonly stdout_path="${smoke_dir}/stdout.log"
readonly stderr_path="${smoke_dir}/stderr.log"
readonly port="$(node -e '
  const server = require("node:net").createServer();
  server.listen(0, "127.0.0.1", () => {
    process.stdout.write(String(server.address().port));
    server.close();
  });
')"
readonly health_url="http://127.0.0.1:${port}/api/health"

mkdir -p "${state_dir}"
print -r -- "{\"host\":\"127.0.0.1\",\"port\":${port},\"thumbnails\":{\"enabled\":false}}" > "${config_path}"

BOOKCAFE_STATE_DIR="${state_dir}" "${sidecar_path}" \
  --config "${config_path}" \
  >"${stdout_path}" \
  2>"${stderr_path}" &
sidecar_pid="$!"

typeset attempt

for attempt in {1..120}; do
  if ! kill -0 "${sidecar_pid}" >/dev/null 2>&1; then
    print -u2 "Bundled sidecar terminated before becoming healthy."
    sed -n '1,120p' "${stdout_path}" >&2
    sed -n '1,120p' "${stderr_path}" >&2
    exit 1
  fi

  if node -e '
    fetch(process.argv[1])
      .then(async (response) => {
        if (!response.ok) process.exit(1);
        const payload = await response.json();
        if (payload.ok !== true || payload.service !== "bookcafe-server") {
          process.exit(1);
        }
      })
      .catch(() => process.exit(1));
  ' "${health_url}"; then
    print "Bundle smoke test passed: ${health_url}"
    exit 0
  fi

  sleep 0.5
done

print -u2 "Bundled sidecar did not become healthy: ${health_url}"
sed -n '1,120p' "${stdout_path}" >&2
sed -n '1,120p' "${stderr_path}" >&2
exit 1
