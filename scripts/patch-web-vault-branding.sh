#!/usr/bin/env bash
# Replace user-visible Bitwarden / Vaultwarden / legacy branding with EBVault.
# Preserves bitwarden.com URLs and package identifiers.
set -euo pipefail

TARGET_DIR="${1:?Usage: patch-web-vault-branding.sh <directory>}"

patch_file() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  sed \
    -e 's/bitwarden\.com/\x01BWDOMAIN\x01/g' \
    -e 's/vault\.bitwarden\.com/\x01VAULTBW\x01/g' \
    -e 's/com\.8bit\.bitwarden/\x01BWPKG\x01/g' \
    -e 's/github\.com\/bitwarden/\x01GHBW\x01/g' \
    -e 's/Mais produtos do Bitwarden/Mais produtos do EBVault/g' \
    -e 's/Mais do Bitwarden/Mais do EBVault/g' \
    -e 's/Bitwarden Authenticator/EBVault Authenticator/g' \
    -e 's/Autenticador EB Vault/Autenticador EBVault/g' \
    -e 's/Autenticador Cofre/Autenticador EBVault/g' \
    -e 's/Bitwarden Inc\./EBVault/g' \
    -e 's/Bitwarden Inc/EBVault/g' \
    -e 's/Novo no Bitwarden?/Novo?/g' \
    -e 's/New to Bitwarden?/New?/g' \
    -e 's/Novo no EBVault?/Novo?/g' \
    -e 's/New to EBVault?/New?/g' \
    -e 's/Conecte-se ao Bitwarden/Conecte-se ao EBVault/g' \
    -e 's/Novo no Bitwarden/Novo/g' \
    -e 's/Log in to Bitwarden/Log in to EBVault/g' \
    -e 's/Bitwarden/EBVault/g' \
    -e 's/Vaultwarden/EBVault/g' \
    -e 's/EB Vault/EBVault/g' \
    -e 's/Cofre/EBVault/g' \
    -e 's/cofre/EBVault/g' \
    -e 's/\x01BWDOMAIN\x01/bitwarden.com/g' \
    -e 's/\x01VAULTBW\x01/vault.bitwarden.com/g' \
    -e 's/\x01BWPKG\x01/com.8bit.bitwarden/g' \
    -e 's/\x01GHBW\x01/github.com\/bitwarden/g' \
    "${file}" > "${tmp}"
  mv "${tmp}" "${file}"
}

echo "Patching EBVault branding under ${TARGET_DIR}"

while IFS= read -r -d '' file; do
  patch_file "${file}"
  echo "  ${file#"${TARGET_DIR}/"}"
done < <(find "${TARGET_DIR}" -type f \( \
  -path '*/locales/*/messages.json' -o \
  -name 'index.html' -o \
  -name 'manifest.webmanifest' -o \
  -name '*.webmanifest' \
  \) -print0 2>/dev/null)

while IFS= read -r -d '' file; do
  patch_file "${file}"
  echo "  ${file#"${TARGET_DIR}/"}"
done < <(find "${TARGET_DIR}" -type f -path '*/assets/*' -name 'messages*.json' -print0 2>/dev/null)

echo "Done."
