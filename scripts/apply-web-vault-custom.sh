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

echo "Done."
