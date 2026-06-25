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
  "apps/web/src/app/app.component.ts"
  "apps/web/src/app/auth/settings/account/account.component.ts"
  "apps/web/src/app/auth/settings/account/account.component.html"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.ts"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.html"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.ts"
  "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.html"
  "apps/web/src/app/auth/settings/two-factor/two-factor-verify.component.ts"
  "apps/web/src/app/auth/settings/two-factor/two-factor-verify.component.html"
  "apps/web/src/app/layouts/frontend-layout.component.ts"
  "apps/web/src/app/layouts/frontend-layout.component.html"
  "libs/auth/src/angular/login/login-secondary-content.component.ts"
  "apps/web/src/app/layouts/user-layout.component.ts"
  "apps/web/src/app/layouts/user-layout.component.html"
  "apps/web/src/app/layouts/web-side-nav.component.html"
  "apps/web/src/app/layouts/product-switcher/navigation-switcher/navigation-switcher.component.html"
  "apps/web/src/app/layouts/product-switcher/product-switcher.component.html"
  "libs/components/src/anon-layout/anon-layout.component.html"
  "libs/components/src/landing-layout/landing-header.component.html"
  "libs/components/src/landing-layout/landing-hero.component.html"
  "libs/components/src/navigation/nav-logo.component.html"
  "libs/auth/src/angular/registration/registration-start/registration-start.component.html"
  "apps/web/src/app/admin-console/organizations/settings/two-factor-setup.component.ts"
  "apps/web/src/app/vault/guards/mandatory-authenticator-account.util.ts"
  "apps/web/src/app/vault/guards/mandatory-authenticator.guard.ts"
  "apps/web/src/app/vault/guards/mandatory-authenticator.policy.ts"
  "apps/web/src/app/vault/guards/mandatory-authenticator-lock.service.ts"
  "apps/web/src/app/vault/guards/mandatory-authenticator-enforcement.service.ts"
  "apps/web/src/app/vault/guards/mandatory-authenticator-api.middleware.ts"
  "apps/web/src/app/vault/guards/setup-extension-redirect.guard.ts"
  "apps/web/src/app/auth/settings/security/security-routing.module.ts"
  "apps/web/src/app/auth/settings/security/security.component.ts"
  "apps/web/src/app/auth/settings/security/security.component.html"
  "apps/web/src/app/admin-console/organizations/layouts/organization-layout.component.ts"
  "apps/web/src/app/admin-console/organizations/layouts/organization-layout.component.html"
)

echo "Applying EBvault web-vault customizations from ${CUSTOM_DIR}"

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

shield_logo_source="${CUSTOM_DIR}/apps/web/src/images/icons/logo-shield.svg"
shield_logo_destination="${CLIENTS_DIR}/apps/web/src/images/icons/logo-shield.svg"
if [[ -f "${shield_logo_source}" ]]; then
  mkdir -p "$(dirname "${shield_logo_destination}")"
  cp "${shield_logo_source}" "${shield_logo_destination}"
  echo "  updated apps/web/src/images/icons/logo-shield.svg"
else
  echo "  missing overlay file: apps/web/src/images/icons/logo-shield.svg" >&2
  exit 1
fi

ebvault_logo_source="${CUSTOM_DIR}/apps/web/src/images/icons/logo-ebvault.svg"
ebvault_logo_destination="${CLIENTS_DIR}/apps/web/src/images/icons/logo-ebvault.svg"
if [[ -f "${ebvault_logo_source}" ]]; then
  mkdir -p "$(dirname "${ebvault_logo_destination}")"
  cp "${ebvault_logo_source}" "${ebvault_logo_destination}"
  echo "  updated apps/web/src/images/icons/logo-ebvault.svg"
else
  echo "  missing overlay file: apps/web/src/images/icons/logo-ebvault.svg" >&2
  exit 1
fi

server_logo="${SCRIPT_DIR}/../src/static/images/logo-ebvault.svg"
if [[ -f "${ebvault_logo_source}" ]]; then
  mkdir -p "$(dirname "${server_logo}")"
  cp "${ebvault_logo_source}" "${server_logo}"
  echo "  updated src/static/images/logo-ebvault.svg"
fi

# Idempotent source patches (routing, favicon, org guards). Fail the build if any step fails.
if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "ERROR: python3 or python is required to apply EBvault routing/favicon patches" >&2
  exit 1
fi

"${PYTHON}" "${SCRIPT_DIR}/apply-web-vault-source-patches.py" "${CLIENTS_DIR}"

# Verify no patch reject files remain.
if find "${CLIENTS_DIR}" -name '*.rej' -print -quit 2>/dev/null | grep -q .; then
  echo "ERROR: patch reject (.rej) files remain under ${CLIENTS_DIR}" >&2
  find "${CLIENTS_DIR}" -name '*.rej' >&2
  exit 1
fi

echo "Done."
