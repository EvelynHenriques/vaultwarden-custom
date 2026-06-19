#!/usr/bin/env python3
"""Idempotently apply mandatory 2FA guards to oss-routing.module.ts."""

from __future__ import annotations

import re
import sys
from pathlib import Path


def ensure_import(text: str) -> str:
    block = """import {
  mandatoryAuthenticatorActivate,
  mandatoryAuthenticatorGuard,
} from "./vault/guards/mandatory-authenticator.guard";"""
    if "mandatoryAuthenticatorActivate" in text and "mandatoryAuthenticatorGuard" in text:
        return text
    text = text.replace(
        'import { mandatoryAuthenticatorGuard } from "./vault/guards/mandatory-authenticator.guard";',
        block,
    )
    if block not in text:
        anchor = 'import { setupExtensionRedirectGuard } from "./vault/guards/setup-extension-redirect.guard";'
        text = text.replace(
            anchor,
            anchor + "\n" + block,
        )
    return text


def add_to_can_activate(line: str, guard: str) -> str:
    if guard in line:
        return line
    return line.replace("canActivate: [", f"canActivate: [{guard}, ", 1)


def main() -> int:
    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")
    original = text

    text = ensure_import(text)

    replacements = [
        (
            r'(path: "remove-password",[\s\S]*?canActivate: \[)authGuard(\])',
            r"\1authGuard, mandatoryAuthenticatorActivate\2",
        ),
        (
            r'(path: AuthRoute\.ChangePassword,[\s\S]*?canActivate: \[)authGuard(\])',
            r"\1authGuard, mandatoryAuthenticatorActivate\2",
        ),
        (
            r"(component: UserLayoutComponent,\s*\n\s*canActivate: \[deepLinkGuard\(\), authGuard)(\])",
            r"\1, mandatoryAuthenticatorActivate\2",
        ),
    ]

    for pattern, repl in replacements:
        text = re.sub(pattern, repl, text, count=1)

    if "runGuardsAndResolvers: \"always\"" not in text:
        text = text.replace(
            "canActivateChild: [mandatoryAuthenticatorGuard],\n    children: [",
            "canActivateChild: [mandatoryAuthenticatorGuard],\n    runGuardsAndResolvers: \"always\",\n    children: [",
            1,
        )

    if "canActivateChild: [mandatoryAuthenticatorGuard]" not in text:
        text = text.replace(
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate],",
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard],\n    runGuardsAndResolvers: \"always\",",
            1,
        )

    simple = [
        (
            "canActivate: [premiumInterestRedirectGuard, setupExtensionRedirectGuard]",
            "canActivate: [mandatoryAuthenticatorActivate, premiumInterestRedirectGuard, setupExtensionRedirectGuard]",
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
        (
            'path: "organizations",\n    loadChildren:',
            'path: "organizations",\n    canActivate: [authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard],\n    loadChildren:',
        ),
    ]

    for old, new in simple:
        if new.split("\n")[0].strip() not in text or old in text:
            text = text.replace(old, new, 1)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  updated mandatory 2FA routing guards in {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
