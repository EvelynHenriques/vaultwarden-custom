#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENTS_DIR="${CLIENTS_DIR:-${REPO_ROOT}/.clients-build}"
COMMIT_HASH="${COMMIT_HASH:-}"
OUTPUT_DIR="${OUTPUT_DIR:-${REPO_ROOT}/web-vault}"

if [[ -z "${COMMIT_HASH}" ]]; then
  echo "Set COMMIT_HASH to the Bitwarden clients commit used by your Vaultwarden release." >&2
  exit 1
fi

if [[ ! -d "${CLIENTS_DIR}/.git" ]]; then
  rm -rf "${CLIENTS_DIR}"
  git clone --depth 1 "https://github.com/bitwarden/clients.git" "${CLIENTS_DIR}"
  git -C "${CLIENTS_DIR}" fetch --depth 1 origin "${COMMIT_HASH}"
  git -C "${CLIENTS_DIR}" checkout FETCH_HEAD
fi

"${SCRIPT_DIR}/apply-web-vault-custom.sh" "${CLIENTS_DIR}"

pushd "${CLIENTS_DIR}" >/dev/null
npm ci --ignore-scripts
pushd apps/web >/dev/null
npm run dist:oss:selfhost
printf '{"version":"%s-vw-mandatory-2fa"}' "${COMMIT_HASH}" > build/vw-version.json
popd >/dev/null
popd >/dev/null

rm -rf "${OUTPUT_DIR}"
mv "${CLIENTS_DIR}/apps/web/build" "${OUTPUT_DIR}"

# Rebrand page metadata in the built web-vault
if [[ -f "${OUTPUT_DIR}/index.html" ]]; then
  sed -i 's/<title>Bitwarden<\/title>/<title>Cofre<\/title>/g' "${OUTPUT_DIR}/index.html" 2>/dev/null || \
    sed -i '' 's/<title>Bitwarden<\/title>/<title>Cofre<\/title>/g' "${OUTPUT_DIR}/index.html" 2>/dev/null || true
fi

echo "Custom web-vault build available at ${OUTPUT_DIR}"
