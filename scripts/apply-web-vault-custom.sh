#!/usr/bin/env bash
set -euo pipefail

CLIENTS_DIR="${1:-clients}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOM_DIR="$(cd "${SCRIPT_DIR}/../web-vault-custom" && pwd)"

if [[ ! -d "${CLIENTS_DIR}" ]]; then
  echo "Bitwarden clients directory not found: ${CLIENTS_DIR}" >&2
  exit 1
fi

OVERLAY_FILES=(
  "apps/web/src/app/auth/settings/account/account.component.ts"
  "apps/web/src/app/auth/settings/account/account.component.html"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.ts"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.html"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.ts"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.html"
  "apps/web/src/app/layouts/frontend-layout.component.ts"
  "apps/web/src/app/layouts/frontend-layout.component.html"
  "libs/auth/src/angular/login/login-secondary-content.component.ts"
  "apps/web/src/app/layouts/user-layout.component.ts"
  "apps/web/src/app/layouts/user-layout.component.html"
  "apps/web/src/app/layouts/web-side-nav.component.html"
  "apps/web/src/app/layouts/product-switcher/navigation-switcher/navigation-switcher.component.html"
  "apps/web/src/app/layouts/product-switcher/product-switcher.component.html"
  "libs/components/src/anon-layout/anon-layout.component.html"
  "libs/auth/src/angular/registration/registration-start/registration-start.component.html"
  "apps/web/src/app/vault/guards/mandatory-authenticator.guard.ts"
  "apps/web/src/app/vault/guards/mandatory-authenticator.policy.ts"
)

echo "Applying Vaultwarden web-vault customizations from ${CUSTOM_DIR}"

for relative in "${OVERLAY_FILES[@]}"; do
  source="${CUSTOM_DIR}/${relative}"
  if [[ ! -f "${source}" ]]; then
    echo "  missing overlay file: ${relative}" >&2
    exit 1
  fi
  destination="${CLIENTS_DIR}/${relative}"
  mkdir -p "$(dirname "${destination}")"
  cp "${source}" "${destination}"
  echo "  updated ${relative}"
done

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

import_patch="${CUSTOM_DIR}/patches/oss-routing-mandatory-import.patch"
if [[ -f "${import_patch}" ]]; then
  if git -C "${CLIENTS_DIR}" apply --check "${import_patch}" >/dev/null 2>&1; then
    git -C "${CLIENTS_DIR}" apply "${import_patch}"
    echo "  applied patches/oss-routing-mandatory-import.patch"
  elif patch -p1 --forward --input="${import_patch}" --directory="${CLIENTS_DIR}"; then
    echo "  applied patches/oss-routing-mandatory-import.patch with patch(1)"
  fi
fi

ROUTING_FILE="${CLIENTS_DIR}/apps/web/src/app/oss-routing.module.ts"
if [[ -f "${ROUTING_FILE}" ]] \
  && grep -q 'mandatoryAuthenticatorActivate' "${ROUTING_FILE}" \
  && ! grep -q 'mandatoryAuthenticatorActivate,' "${ROUTING_FILE}"; then
  echo "  fixing mandatoryAuthenticatorActivate import in oss-routing.module.ts"
  python3 - "${ROUTING_FILE}" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
old = 'import { mandatoryAuthenticatorGuard } from "./vault/guards/mandatory-authenticator.guard";'
new = """import {
  mandatoryAuthenticatorActivate,
  mandatoryAuthenticatorGuard,
} from "./vault/guards/mandatory-authenticator.guard";"""
if old in text:
    path.write_text(text.replace(old, new), encoding="utf-8")
PY
fi

marketing_patch="${CUSTOM_DIR}/patches/oss-routing-marketing.patch"
if [[ -f "${marketing_patch}" ]]; then
  if git -C "${CLIENTS_DIR}" apply --check "${marketing_patch}" >/dev/null 2>&1; then
    git -C "${CLIENTS_DIR}" apply "${marketing_patch}"
    echo "  applied patches/oss-routing-marketing.patch"
  elif patch -p1 --forward --input="${marketing_patch}" --directory="${CLIENTS_DIR}"; then
    echo "  applied patches/oss-routing-marketing.patch with patch(1)"
  else
    echo "  warning: could not apply patches/oss-routing-marketing.patch" >&2
  fi
fi

org_routing_patch="${CUSTOM_DIR}/patches/organization-routing.module.patch"
if [[ -f "${org_routing_patch}" ]]; then
  if git -C "${CLIENTS_DIR}" apply --check "${org_routing_patch}" >/dev/null 2>&1; then
    git -C "${CLIENTS_DIR}" apply "${org_routing_patch}"
    echo "  applied patches/organization-routing.module.patch"
  elif patch -p1 --forward --input="${org_routing_patch}" --directory="${CLIENTS_DIR}"; then
    echo "  applied patches/organization-routing.module.patch with patch(1)"
  else
    echo "  warning: could not apply patches/organization-routing.module.patch" >&2
  fi
fi

echo "Done."
