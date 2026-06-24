#!/usr/bin/env python3
"""Idempotently remove Bitwarden marketing/subscription routes from oss-routing.module.ts."""

from __future__ import annotations

import re
import sys
from pathlib import Path


def apply_marketing_routing(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    replacements = [
        (
            re.compile(
                r'path: "sm-landing",\s*'
                r'component: SMLandingComponent,\s*'
                r'data: \{ titleId: "moreProductsFromBitwarden" \},',
                re.MULTILINE,
            ),
            'path: "sm-landing",\n        redirectTo: "vault",\n        pathMatch: "full",',
        ),
        (
            re.compile(
                r'path: "request-sm-access",\s*'
                r'component: RequestSMAccessComponent,\s*'
                r'data: \{ titleId: "requestAccessToSecretsManager" \},',
                re.MULTILINE,
            ),
            'path: "request-sm-access",\n        redirectTo: "vault",\n        pathMatch: "full",',
        ),
        (
            re.compile(
                r'path: "subscription",\s*'
                r'loadChildren: \(\) =>\s*'
                r'import\("\./billing/individual/individual-billing\.module"\)\.then\(\s*'
                r'\(m\) => m\.IndividualBillingModule,\s*'
                r'\),',
                re.MULTILINE,
            ),
            'path: "subscription",\n            redirectTo: "account",\n            pathMatch: "prefix",',
        ),
    ]

    for pattern, repl in replacements:
        text = pattern.sub(repl, text, count=1)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  updated marketing/subscription routes in {path.name}")
        return True

    if "moreProductsFromBitwarden" in text and "redirectTo: \"vault\"" not in text:
        raise RuntimeError(f"{path}: sm-landing marketing route still present")

    print(f"  marketing/subscription routes already updated in {path.name}")
    return False


def main() -> int:
    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"ERROR: missing {path}")
    apply_marketing_routing(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
