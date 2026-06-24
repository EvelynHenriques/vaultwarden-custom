#!/usr/bin/env python3
"""Idempotently apply mandatory 2FA guards to oss-routing.module.ts."""

from __future__ import annotations

import re
import sys
from pathlib import Path

IMPORT_BLOCK = """import {
  mandatoryAuthenticatorActivate,
  mandatoryAuthenticatorGuard,
} from "./vault/guards/mandatory-authenticator.guard";"""


def ensure_import(text: str) -> str:
    if "mandatoryAuthenticatorActivate" in text and "mandatoryAuthenticatorGuard" in text:
        return text

    patterns = [
        'import { mandatoryAuthenticatorGuard } from "./vault/guards/mandatory-authenticator.guard";',
        """import {
  mandatoryAuthenticatorActivate,
  mandatoryAuthenticatorGuard,
} from "./vault/guards/mandatory-authenticator.guard";""",
    ]
    for pattern in patterns:
        if pattern in text and pattern != IMPORT_BLOCK:
            text = text.replace(pattern, IMPORT_BLOCK)

    if IMPORT_BLOCK not in text:
        anchor = 'import { setupExtensionRedirectGuard } from "./vault/guards/setup-extension-redirect.guard";'
        if anchor not in text:
            raise RuntimeError("Could not find setupExtensionRedirectGuard import anchor")
        text = text.replace(anchor, anchor + "\n" + IMPORT_BLOCK)

    return text


def fix_user_layout_guard(text: str) -> str:
    """Repair incorrect parent canActivate using mandatoryAuthenticatorGuard."""
    wrong_patterns = [
        "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorGuard]",
        "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate, mandatoryAuthenticatorGuard]",
    ]
    correct = """canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate],
    canActivateChild: [mandatoryAuthenticatorGuard],
    runGuardsAndResolvers: "always\""""
    for wrong in wrong_patterns:
        if wrong in text:
            text = text.replace(wrong, correct, 1)
            return text

    if "component: UserLayoutComponent," in text and "canActivateChild: [mandatoryAuthenticatorGuard]" not in text:
        text = text.replace(
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate],",
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard],\n    runGuardsAndResolvers: \"always\",",
            1,
        )
        text = text.replace(
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard],",
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard],\n    runGuardsAndResolvers: \"always\",",
            1,
        )
    return text


def fix_organizations_guard(text: str) -> str:
    wrong = "canActivate: [authGuard, mandatoryAuthenticatorGuard],"
    correct = """canActivate: [authGuard, mandatoryAuthenticatorActivate],
    canActivateChild: [mandatoryAuthenticatorGuard],"""
    if wrong in text:
        return text.replace(wrong, correct, 1)

    if 'path: "organizations",' in text and "canActivateChild: [mandatoryAuthenticatorGuard]" not in text.split('path: "organizations",')[1].split("loadChildren")[0]:
        text = text.replace(
            'path: "organizations",\n    canActivate: [authGuard],',
            'path: "organizations",\n    canActivate: [authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard],',
            1,
        )
        text = text.replace(
            'path: "organizations",\n    loadChildren:',
            'path: "organizations",\n    canActivate: [authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard],\n    loadChildren:',
            1,
        )
    return text


def apply_mandatory_routing(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    text = ensure_import(text)
    text = fix_user_layout_guard(text)
    text = fix_organizations_guard(text)

    regex_replacements = [
        (
            r'(path: "remove-password",[\s\S]*?canActivate: \[)authGuard(\])',
            r"\1authGuard, mandatoryAuthenticatorActivate\2",
        ),
        (
            r'(path: AuthRoute\.ChangePassword,[\s\S]*?canActivate: \[)authGuard(\])',
            r"\1authGuard, mandatoryAuthenticatorActivate\2",
        ),
    ]
    for pattern, repl in regex_replacements:
        text = re.sub(pattern, repl, text, count=1)

    simple = [
        (
            'path: "setup-extension",',
            'path: "setup-extension",\n    canActivate: [mandatoryAuthenticatorActivate],',
        ),
        (
            "canActivate: [premiumInterestRedirectGuard, setupExtensionRedirectGuard]",
            "canActivate: [mandatoryAuthenticatorActivate, setupExtensionRedirectGuard]",
        ),
        (
            "canActivate: [mandatoryAuthenticatorActivate, premiumInterestRedirectGuard, setupExtensionRedirectGuard]",
            "canActivate: [mandatoryAuthenticatorActivate, setupExtensionRedirectGuard]",
        ),
        (
            "canActivate: [\n          organizationPolicyGuard",
            "canActivate: [\n          mandatoryAuthenticatorActivate,\n          organizationPolicyGuard",
        ),
        (
            'path: "create-organization",\n        component: CreateOrganizationComponent',
            'path: "create-organization",\n        canActivate: [mandatoryAuthenticatorActivate],\n        component: CreateOrganizationComponent',
        ),
        (
            'path: "settings",\n        children: [',
            'path: "settings",\n        canActivateChild: [mandatoryAuthenticatorGuard],\n        children: [',
        ),
        (
            'canActivate: [authGuard],\n        children: [\n          { path: "", pathMatch: "full", redirectTo: "generator" }',
            'canActivate: [mandatoryAuthenticatorActivate, authGuard],\n        children: [\n          { path: "", pathMatch: "full", redirectTo: "generator" }',
        ),
        (
            'path: "reports",\n        loadChildren:',
            'path: "reports",\n        canActivate: [mandatoryAuthenticatorActivate],\n        loadChildren:',
        ),
    ]

    for old, new in simple:
        if old in text:
            text = text.replace(old, new, 1)

    verify_mandatory_routing(text, path)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  updated mandatory 2FA routing guards in {path.name}")
        return True

    print(f"  mandatory 2FA routing already applied in {path.name}")
    verify_mandatory_routing(text, path)
    return False


def verify_mandatory_routing(text: str, path: Path) -> None:
    checks = [
        ("mandatoryAuthenticatorActivate import", "mandatoryAuthenticatorActivate"),
        ("UserLayout canActivateChild", "canActivateChild: [mandatoryAuthenticatorGuard]"),
        ("UserLayout runGuardsAndResolvers", 'runGuardsAndResolvers: "always"'),
        ("setup-extension guard", 'path: "setup-extension",\n    canActivate: [mandatoryAuthenticatorActivate]'),
        ("vault mandatory guard", "canActivate: [mandatoryAuthenticatorActivate, setupExtensionRedirectGuard]"),
        ("settings child guard", 'path: "settings",\n        canActivateChild: [mandatoryAuthenticatorGuard]'),
        ("organizations child guard", 'path: "organizations",\n    canActivate: [authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard]'),
    ]
    missing = [label for label, needle in checks if needle not in text]
    if missing:
        raise RuntimeError(f"{path}: mandatory routing verification failed: {', '.join(missing)}")

    if "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorGuard]" in text:
        raise RuntimeError(f"{path}: UserLayout still uses mandatoryAuthenticatorGuard on canActivate (wrong)")


def main() -> int:
    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"ERROR: missing {path}")
    apply_mandatory_routing(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
