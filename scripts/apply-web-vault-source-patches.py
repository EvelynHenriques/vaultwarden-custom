#!/usr/bin/env python3
"""Apply all EBvault source patches idempotently (replaces fragile patch(1) files)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def run_step(name: str, script: str, *args: str) -> None:
    script_path = SCRIPT_DIR / script
    if not script_path.is_file():
        raise SystemExit(f"ERROR: missing patch script {script_path}")
    print(f"  running {name}...")
    result = subprocess.run([sys.executable, str(script_path), *args], check=False)
    if result.returncode != 0:
        raise SystemExit(f"ERROR: {name} failed with exit code {result.returncode}")


def main() -> int:
    clients_dir = Path(sys.argv[1])
    if not clients_dir.is_dir():
        print(f"ERROR: clients directory not found: {clients_dir}", file=sys.stderr)
        return 1

    oss_routing = clients_dir / "apps/web/src/app/oss-routing.module.ts"
    org_routing = clients_dir / "apps/web/src/app/admin-console/organizations/organization-routing.module.ts"

    print("Applying EBvault source patches (Python, idempotent)...")
    run_step("disable server notifications", "apply-disable-server-notifications-patch.py", str(clients_dir))
    run_step("index favicon/title", "apply-index-favicon.py", str(clients_dir))
    run_step("registration login redirect", "apply-registration-login-redirect-patch.py", str(clients_dir))
    run_step("mandatory 2FA routing", "apply-mandatory-2fa-routing.py", str(oss_routing))
    run_step("mandatory 2FA API errors", "apply-mandatory-2fa-api-patch.py", str(clients_dir))
    run_step("login 2FA submit UX", "apply-mandatory-2fa-login-two-factor-patch.py", str(clients_dir))
    run_step("defer post-login sync", "apply-mandatory-2fa-defer-login-sync-patch.py", str(clients_dir))
    run_step("verify mandatory 2FA generated flow", "verify-mandatory-2fa-generated-flow.py", str(clients_dir))
    run_step("marketing routing", "apply-marketing-routing.py", str(oss_routing))
    run_step("organization routing", "apply-organization-routing.py", str(org_routing))

    for rej in clients_dir.rglob("*.rej"):
        print(f"  removing stale reject file: {rej.relative_to(clients_dir)}")
        rej.unlink()

    print("EBvault source patches applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
