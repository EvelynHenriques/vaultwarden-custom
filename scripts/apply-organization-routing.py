#!/usr/bin/env python3
"""Idempotently add mandatory 2FA child guard to organization-routing.module.ts."""

from __future__ import annotations

import sys
from pathlib import Path

IMPORT_LINE = 'import { mandatoryAuthenticatorGuard } from "../../vault/guards/mandatory-authenticator.guard";'
CHILD_GUARD = "    canActivateChild: [mandatoryAuthenticatorGuard],"


def apply_organization_routing(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    if IMPORT_LINE not in text:
        anchor = 'import { organizationRedirectGuard } from "./guards/org-redirect.guard";'
        if anchor not in text:
            raise RuntimeError(f"{path}: could not find import anchor for mandatory guard")
        text = text.replace(anchor, anchor + "\n" + IMPORT_LINE)

    marker = "canActivate: [deepLinkGuard(), authGuard, organizationPermissionsGuard(canAccessOrgAdmin)],"
    if marker in text and CHILD_GUARD not in text:
        text = text.replace(
            marker,
            marker + "\n" + CHILD_GUARD,
            1,
        )

    if "mandatoryAuthenticatorGuard" not in text:
        raise RuntimeError(f"{path}: mandatoryAuthenticatorGuard not applied")

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  updated mandatory 2FA org routing in {path.name}")
        return True

    print(f"  organization routing already has mandatory 2FA guard")
    return False


def main() -> int:
    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"ERROR: missing {path}")
    apply_organization_routing(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
