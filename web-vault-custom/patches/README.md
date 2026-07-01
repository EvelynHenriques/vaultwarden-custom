# Deprecated: use Python scripts in `scripts/` instead

These unified diff patches are **no longer applied** during the EBcofre build.

They failed frequently when the upstream Bitwarden clients commit changed line
context (malformed hunks, reversed patches, `.rej` reject files).

## Replacement

`scripts/apply-web-vault-custom.sh` now runs idempotent Python patchers:

| Script | Purpose |
|--------|---------|
| `apply-web-vault-source-patches.py` | Orchestrator (fails build on error) |
| `apply-index-favicon.py` | `index.html` title + `logo-shield.svg` favicon |
| `apply-mandatory-2fa-routing.py` | Mandatory 2FA guards on `oss-routing.module.ts` |
| `apply-marketing-routing.py` | Remove subscription / SM landing marketing routes |
| `apply-organization-routing.py` | Mandatory 2FA child guard on org routing |

The build **fails** if any step errors or if `.rej` files remain.

## Legacy patch files (reference only)

- `index-favicon.patch` — superseded by `apply-index-favicon.py`
- `oss-routing.module.patch` — superseded by `apply-mandatory-2fa-routing.py`
- `oss-routing-mandatory-import.patch` — merged into mandatory routing script
- `oss-routing-marketing.patch` — superseded by `apply-marketing-routing.py`
- `organization-routing.module.patch` — superseded by `apply-organization-routing.py`
