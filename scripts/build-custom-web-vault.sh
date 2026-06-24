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

# The Angular web-vault build typically needs 4–8 GiB of free RAM.
# On small servers, stop Docker containers first or build on another machine and copy ./web-vault.
if [[ "${SKIP_MEM_CHECK:-}" != "1" ]] && command -v free >/dev/null 2>&1; then
  avail_kb="$(free | awk '/^Mem:/ {print $7}')"
  avail_mb=$((avail_kb / 1024))
  if (( avail_mb < 2048 )); then
    echo "WARNING: Only ~${avail_mb} MiB memory available (need at least ~2 GiB, ideally 4+ GiB)." >&2
    echo "The build will likely be killed by the OOM killer during 'npm run dist:oss:selfhost'." >&2
    echo "" >&2
    echo "Options:" >&2
    echo "  1. Stop services to free RAM:  docker compose -f /vaultwarden/docker-compose.yml stop" >&2
    echo "  2. Build on a PC with more RAM, then copy the web-vault/ folder to this server." >&2
    echo "  3. Force anyway (may hang or die):  SKIP_MEM_CHECK=1 $0" >&2
    exit 1
  fi
fi

if [[ ! -d "${CLIENTS_DIR}/.git" ]]; then
  rm -rf "${CLIENTS_DIR}"
  git clone --depth 1 "https://github.com/bitwarden/clients.git" "${CLIENTS_DIR}"
  git -C "${CLIENTS_DIR}" fetch --depth 1 origin "${COMMIT_HASH}"
  git -C "${CLIENTS_DIR}" checkout FETCH_HEAD
fi

"${SCRIPT_DIR}/apply-web-vault-custom.sh" "${CLIENTS_DIR}"

# Rebrand locale strings (Bitwarden/Vaultwarden -> EBvault) before webpack bundles them.
"${SCRIPT_DIR}/patch-web-vault-branding.sh" "${CLIENTS_DIR}/apps/web/src/locales"

pushd "${CLIENTS_DIR}" >/dev/null
npm ci --ignore-scripts
pushd apps/web >/dev/null
# Limit Node heap (override with NODE_OPTIONS if you have more RAM).
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
npm run dist:oss:selfhost
printf '{"version":"%s-vw-mandatory-2fa"}' "${COMMIT_HASH}" > build/vw-version.json
popd >/dev/null
popd >/dev/null

rm -rf "${OUTPUT_DIR}"
mv "${CLIENTS_DIR}/apps/web/build" "${OUTPUT_DIR}"

"${SCRIPT_DIR}/patch-web-vault-branding.sh" "${OUTPUT_DIR}"

# Favicon, manifest, and document title in the built web-vault output.
if [[ -f "${OUTPUT_DIR}/index.html" ]]; then
  INDEX="${OUTPUT_DIR}/index.html"
  sed -i 's/<title[^>]*>[^<]*<\/title>/<title>EBvault<\/title>/' "${INDEX}" 2>/dev/null || \
    sed -i '' 's/<title[^>]*>[^<]*<\/title>/<title>EBvault<\/title>/' "${INDEX}" 2>/dev/null || true
  # Remove only <link rel="icon" ...> tags — never delete whole lines (minified index.html is often one line).
  sed -i 's/<link[^>]*rel="icon"[^>]*>//g' "${INDEX}" 2>/dev/null || \
    sed -i '' 's/<link[^>]*rel="icon"[^>]*>//g' "${INDEX}" 2>/dev/null || true
  if ! grep -q 'logo-shield.svg' "${INDEX}"; then
    sed -i 's|</head>|    <link rel="icon" type="image/svg+xml" href="images/icons/logo-shield.svg" />\n</head>|' "${INDEX}" 2>/dev/null || \
      sed -i '' 's|</head>|    <link rel="icon" type="image/svg+xml" href="images/icons/logo-shield.svg" />\n</head>|' "${INDEX}" 2>/dev/null || true
  fi
  sed -i 's|<link rel="apple-touch-icon"[^>]*>|<link rel="apple-touch-icon" href="images/icons/logo-shield.svg" />|g' "${INDEX}" 2>/dev/null || \
    sed -i '' 's|<link rel="apple-touch-icon"[^>]*>|<link rel="apple-touch-icon" href="images/icons/logo-shield.svg" />|g' "${INDEX}" 2>/dev/null || true
  sed -i 's|<link rel="mask-icon"[^>]*>|<link rel="mask-icon" href="images/icons/logo-shield.svg" color="#556b2f" />|g' "${INDEX}" 2>/dev/null || \
    sed -i '' 's|<link rel="mask-icon"[^>]*>|<link rel="mask-icon" href="images/icons/logo-shield.svg" color="#556b2f" />|g' "${INDEX}" 2>/dev/null || true
  if ! grep -q 'vaultwarden.css' "${INDEX}"; then
    sed -i 's|</head>|<link rel="stylesheet" href="css/vaultwarden.css" />\n</head>|' "${INDEX}" 2>/dev/null || \
      sed -i '' 's|</head>|<link rel="stylesheet" href="css/vaultwarden.css" />\n</head>|' "${INDEX}" 2>/dev/null || true
  fi
  if ! grep -qi '<!doctype html>' "${INDEX}"; then
    echo "ERROR: index.html is missing <!DOCTYPE html> after branding patches — aborting." >&2
    exit 1
  fi
fi

MANIFEST="${OUTPUT_DIR}/manifest.json"
if [[ -f "${MANIFEST}" ]]; then
  cat > "${MANIFEST}" <<'EOF'
{
  "name": "EBvault",
  "short_name": "EBvault",
  "icons": [
    {
      "src": "images/icons/logo-shield.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ],
  "theme_color": "#556b2f",
  "background_color": "#556b2f"
}
EOF
fi

echo "Custom web-vault build available at ${OUTPUT_DIR}"
