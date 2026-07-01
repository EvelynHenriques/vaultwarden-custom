#!/usr/bin/env bash
# Replace user-visible Bitwarden / Vaultwarden / legacy branding with EBcofre.
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
    -e 's/Mais produtos do Bitwarden/Mais produtos do EBcofre/g' \
    -e 's/Mais do Bitwarden/Mais do EBcofre/g' \
    -e 's/Bitwarden Authenticator/EBcofre Authenticator/g' \
    -e 's/Autenticador EB Vault/Autenticador EBcofre/g' \
    -e 's/Autenticador Cofre/Autenticador EBcofre/g' \
    -e 's/Bitwarden Inc\./EBcofre/g' \
    -e 's/Bitwarden Inc/EBcofre/g' \
    -e 's/"newToBitwarden": "[^"]*"/"newToBitwarden": "Novo?"/g' \
    -e 's/"logInToBitwarden": "[^"]*"/"logInToBitwarden": "Conecte-se ao EBcofre"/g' \
    -e 's/"bitWebVault": "[^"]*"/"bitWebVault": "EBcofre"/g' \
    -e 's/"webVault": "[^"]*"/"webVault": "EBcofre"/g' \
    -e 's/"appLogoLabel": "[^"]*"/"appLogoLabel": "EBcofre"/g' \
    -e 's/"passwordManager": "[^"]*"/"passwordManager": "EBcofre"/g' \
    -e 's/Novo no Bitwarden?/Novo?/g' \
    -e 's/New to Bitwarden?/New?/g' \
    -e 's/Novo no EBcofre?/Novo?/g' \
    -e 's/New to EBcofre?/New?/g' \
    -e 's/Conecte-se ao Bitwarden/Conecte-se ao EBcofre/g' \
    -e 's/Novo no Bitwarden/Novo/g' \
    -e 's/Log in to Bitwarden/Log in to EBcofre/g' \
    -e 's/Bitwarden/EBcofre/g' \
    -e 's/Vaultwarden/EBcofre/g' \
    -e 's/EBcofre web do EBcofre/EBcofre/g' \
    -e 's/web do EBcofre/EBcofre/g' \
    -e 's/EBcofre/EBcofre/g' \
    -e 's/EB Vault/EBcofre/g' \
    -e 's/\x01BWDOMAIN\x01/bitwarden.com/g' \
    -e 's/\x01VAULTBW\x01/vault.bitwarden.com/g' \
    -e 's/\x01BWPKG\x01/com.8bit.bitwarden/g' \
    -e 's/\x01GHBW\x01/github.com\/bitwarden/g' \
    "${file}" > "${tmp}"
  mv "${tmp}" "${file}"
}

echo "Patching EBcofre branding under ${TARGET_DIR}"

while IFS= read -r -d '' file; do
  patch_file "${file}"
  echo "  ${file#"${TARGET_DIR}/"}"
done < <(find "${TARGET_DIR}" -type f \( \
  -path '*/locales/*/messages.json' -o \
  -name 'index.html' -o \
  -name 'manifest.json' -o \
  -name 'manifest.webmanifest' -o \
  -name '*.webmanifest' \
  \) -print0 2>/dev/null)

while IFS= read -r -d '' file; do
  patch_file "${file}"
  echo "  ${file#"${TARGET_DIR}/"}"
done < <(find "${TARGET_DIR}" -type f -path '*/assets/*' -name 'messages*.json' -print0 2>/dev/null)

echo "Done."
