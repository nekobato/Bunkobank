#!/bin/zsh

# Builds, signs, notarizes, staples, and validates the local macOS DMG.

set -euo pipefail

typeset mount_dir=""

cleanup() {
  if [[ -n "${mount_dir}" && -d "${mount_dir}" ]]; then
    hdiutil detach "${mount_dir}" >/dev/null 2>&1 || true
    rmdir "${mount_dir}" >/dev/null 2>&1 || true
  fi

  unset APPLE_PASSWORD 2>/dev/null || true
}

trap cleanup EXIT

readonly script_dir="${0:A:h}"
readonly desktop_dir="${script_dir:h}"
readonly env_file="${desktop_dir}/.env.notarization"

typeset build_target=""
typeset expects_target="false"
typeset argument

for argument in "$@"; do
  if [[ "${expects_target}" == "true" ]]; then
    build_target="${argument}"
    expects_target="false"
    continue
  fi

  case "${argument}" in
    --target)
      expects_target="true"
      ;;
    --target=*)
      build_target="${argument#--target=}"
      ;;
  esac
done

typeset target_dir="${desktop_dir}/src-tauri/target"

if [[ -n "${build_target}" ]]; then
  target_dir="${target_dir}/${build_target}"
else
  build_target="$(rustc -vV | sed -n 's/^host: //p')"
fi

case "${build_target}" in
  aarch64-apple-darwin)
    readonly dmg_arch="aarch64"
    ;;
  x86_64-apple-darwin)
    readonly dmg_arch="x64"
    ;;
  *)
    print -u2 "Unsupported macOS release target: ${build_target}"
    exit 1
    ;;
esac

readonly dmg_path="${target_dir}/release/bundle/dmg/BookCafe_2.0.0_${dmg_arch}.dmg"

if [[ ! -f "${env_file}" ]]; then
  print -u2 "Missing notarization environment file: ${env_file}"
  exit 1
fi

set -a
source "${env_file}"
set +a

: "${APPLE_ID:?APPLE_ID is required in .env.notarization}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required in .env.notarization}"

if [[ -z "${APPLE_PASSWORD:-}" ]]; then
  read -r -s "APPLE_PASSWORD?Apple app-specific password: "
  print
  export APPLE_PASSWORD
fi

cd "${desktop_dir}"

if command -v timeout >/dev/null 2>&1; then
  timeout 3600s pnpm exec tauri build --bundles dmg "$@"
else
  pnpm exec tauri build --bundles dmg "$@"
fi

xcrun notarytool submit "${dmg_path}" \
  --apple-id "${APPLE_ID}" \
  --password "${APPLE_PASSWORD}" \
  --team-id "${APPLE_TEAM_ID}" \
  --wait
xcrun stapler staple "${dmg_path}"

mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/bookcafe-notarization.XXXXXX")"
hdiutil attach -readonly -nobrowse -mountpoint "${mount_dir}" "${dmg_path}"

readonly mounted_app_path="${mount_dir}/BookCafe.app"

codesign --verify --deep --strict --verbose=2 "${mounted_app_path}"
xcrun stapler validate "${mounted_app_path}"
xcrun stapler validate "${dmg_path}"
spctl --assess --type execute --verbose=4 "${mounted_app_path}"
spctl --assess --type open --context context:primary-signature --verbose=4 "${dmg_path}"

hdiutil detach "${mount_dir}"
rmdir "${mount_dir}"
mount_dir=""

print "Signed and notarized DMG: ${dmg_path}"
