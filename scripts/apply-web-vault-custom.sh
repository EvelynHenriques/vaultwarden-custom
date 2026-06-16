#!/usr/bin/env bash
set -euo pipefail

CLIENTS_DIR="${1:-clients}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOM_DIR="$(cd "${SCRIPT_DIR}/../web-vault-custom" && pwd)"

if [[ ! -d "${CLIENTS_DIR}" ]]; then
  echo "Bitwarden clients directory not found: ${CLIENTS_DIR}" >&2
  exit 1
fi

echo "Applying Vaultwarden web-vault customizations from ${CUSTOM_DIR}"

while IFS= read -r -d '' file; do
  relative="${file#${CUSTOM_DIR}/}"
  if [[ "${relative}" == patches/* ]]; then
    continue
  fi
  destination="${CLIENTS_DIR}/${relative}"
  mkdir -p "$(dirname "${destination}")"
  cp "${file}" "${destination}"
  echo "  updated ${relative}"
done < <(find "${CUSTOM_DIR}" -type f ! -path "${CUSTOM_DIR}/patches/*" -print0)

patch_file="${CUSTOM_DIR}/patches/oss-routing.module.patch"
if [[ -f "${patch_file}" ]]; then
  if git -C "${CLIENTS_DIR}" apply --check "${patch_file}" >/dev/null 2>&1; then
    git -C "${CLIENTS_DIR}" apply "${patch_file}"
    echo "  applied patches/oss-routing.module.patch"
  elif patch -p1 --forward --input="${patch_file}" --directory="${CLIENTS_DIR}"; then
    echo "  applied patches/oss-routing.module.patch with patch(1)"
  else
    echo "  warning: could not apply patches/oss-routing.module.patch" >&2
    echo "  add mandatoryAuthenticatorGuard to oss-routing.module.ts manually" >&2
  fi
fi

echo "Done."
