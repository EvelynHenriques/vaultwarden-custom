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

SETUP_EXTENSION_IMPORT = """import {
  blockSetupExtensionUntilMandatory2faGuard,
  setupExtensionRedirectGuard,
} from "./vault/guards/setup-extension-redirect.guard";"""

LEGACY_SETUP_EXTENSION_IMPORT = (
    'import { setupExtensionRedirectGuard } from "./vault/guards/setup-extension-redirect.guard";'
)


def ensure_import(text: str) -> str:
    if LEGACY_SETUP_EXTENSION_IMPORT in text:
        text = text.replace(LEGACY_SETUP_EXTENSION_IMPORT, SETUP_EXTENSION_IMPORT)

    if IMPORT_BLOCK not in text:
        patterns = [
            'import { mandatoryAuthenticatorGuard } from "./vault/guards/mandatory-authenticator.guard";',
        ]
        for pattern in patterns:
            if pattern in text:
                text = text.replace(pattern, IMPORT_BLOCK)

        if IMPORT_BLOCK not in text:
            if SETUP_EXTENSION_IMPORT in text:
                text = text.replace(
                    SETUP_EXTENSION_IMPORT,
                    SETUP_EXTENSION_IMPORT + "\n" + IMPORT_BLOCK,
                )
            else:
                raise RuntimeError("Could not find setupExtensionRedirectGuard import anchor")

    return text


def fix_user_layout_guard(text: str) -> str:
    """Repair incorrect parent canActivate using mandatoryAuthenticatorGuard."""
    user_layout_pattern = re.compile(
        r'(component: UserLayoutComponent,\n\s*)'
        r'canActivate: \[[^\]]*\],\n'
        r'(?:\s*canActivateChild: \[mandatoryAuthenticatorGuard\],\n)?'
        r'(?:\s*runGuardsAndResolvers: "always",\n)?'
    )
    text = user_layout_pattern.sub(
        r'\1canActivate: [deepLinkGuard(), authGuard],'
        "\n    canActivateChild: [mandatoryAuthenticatorGuard],"
        '\n    runGuardsAndResolvers: "always",\n',
        text,
        count=1,
    )

    wrong_patterns = [
        "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorGuard]",
        "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate, mandatoryAuthenticatorGuard]",
        "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate]",
    ]
    correct = (
        'canActivate: [deepLinkGuard(), authGuard],\n'
        '    canActivateChild: [mandatoryAuthenticatorGuard],\n'
        '    runGuardsAndResolvers: "always",'
    )
    for wrong in wrong_patterns:
        if wrong in text:
            text = text.replace(wrong, correct, 1)
            return text

    if "component: UserLayoutComponent," in text and "canActivateChild: [mandatoryAuthenticatorGuard]" not in text:
        text = text.replace(
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate],",
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard],\n    canActivateChild: [mandatoryAuthenticatorGuard],\n    runGuardsAndResolvers: \"always\",",
            1,
        )
        text = text.replace(
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard],",
            "component: UserLayoutComponent,\n    canActivate: [deepLinkGuard(), authGuard],\n    canActivateChild: [mandatoryAuthenticatorGuard],\n    runGuardsAndResolvers: \"always\",",
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


def merge_guard_list(existing: str, guard: str) -> str:
    guards = [item.strip() for item in existing.split(",") if item.strip()]
    if guard not in guards:
        guards.append(guard)
    return ", ".join(guards)


def fix_setup_extension_guard(text: str) -> str:
    """Add setup-extension mandatory guard without duplicating canActivate."""
    guard = "blockSetupExtensionUntilMandatory2faGuard"

    duplicate_pattern = re.compile(
        r'(path: "setup-extension",\n\s*canActivate: \[)([^\]]*)(\],\n)\s*canActivate: \[blockSetupExtensionUntilMandatory2faGuard\],'
    )

    def repair_duplicate(match: re.Match[str]) -> str:
        merged = merge_guard_list(match.group(2), guard)
        return f"{match.group(1)}{merged}{match.group(3)}"

    text = duplicate_pattern.sub(repair_duplicate, text)

    route_pattern = re.compile(
        r'(?P<path_line>path: "setup-extension",\n)(?P<body>[\s\S]*?)(?=\n\s*\},)'
    )
    match = route_pattern.search(text)
    if not match:
        raise RuntimeError("Could not find setup-extension route")

    body = match.group("body")
    can_activate_pattern = re.compile(r'(?P<prefix>\s*canActivate: \[)(?P<guards>[^\]]*)(?P<suffix>\],)')

    can_activate_match = can_activate_pattern.search(body)
    if can_activate_match:
        merged = merge_guard_list(can_activate_match.group("guards"), guard)
        body = (
            body[: can_activate_match.start()]
            + f"{can_activate_match.group('prefix')}{merged}{can_activate_match.group('suffix')}"
            + body[can_activate_match.end() :]
        )
    else:
        body = f"    canActivate: [{guard}],\n" + body

    return text[: match.start()] + match.group("path_line") + body + text[match.end() :]


def apply_mandatory_routing(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    text = ensure_import(text)
    text = fix_user_layout_guard(text)
    text = fix_organizations_guard(text)
    text = fix_setup_extension_guard(text)

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
            "canActivate: [mandatoryAuthenticatorActivate, setupExtensionRedirectGuard]",
            "canActivate: [premiumInterestRedirectGuard, setupExtensionRedirectGuard]",
        ),
        (
            "canActivate: [mandatoryAuthenticatorActivate, premiumInterestRedirectGuard, setupExtensionRedirectGuard]",
            "canActivate: [premiumInterestRedirectGuard, setupExtensionRedirectGuard]",
        ),
        (
            'path: "settings",\n        canActivateChild: [mandatoryAuthenticatorGuard],\n        children: [',
            'path: "settings",\n        children: [',
        ),
        (
            'canActivate: [mandatoryAuthenticatorActivate, authGuard],\n        children: [\n          { path: "", pathMatch: "full", redirectTo: "generator" }',
            'canActivate: [authGuard],\n        children: [\n          { path: "", pathMatch: "full", redirectTo: "generator" }',
        ),
        (
            'path: "reports",\n        canActivate: [mandatoryAuthenticatorActivate],\n        loadChildren:',
            'path: "reports",\n        loadChildren:',
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
        ("UserLayout upstream canActivate", "canActivate: [deepLinkGuard(), authGuard]"),
        ("setup-extension guard", "blockSetupExtensionUntilMandatory2faGuard"),
        ("blockSetupExtension import", "blockSetupExtensionUntilMandatory2faGuard"),
        ("vault upstream guards preserved", "canActivate: [premiumInterestRedirectGuard, setupExtensionRedirectGuard]"),
        ("organizations child guard", 'path: "organizations",\n    canActivate: [authGuard, mandatoryAuthenticatorActivate],\n    canActivateChild: [mandatoryAuthenticatorGuard]'),
    ]
    missing = [label for label, needle in checks if needle not in text]
    if missing:
        raise RuntimeError(f"{path}: mandatory routing verification failed: {', '.join(missing)}")

    if "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorGuard]" in text:
        raise RuntimeError(f"{path}: UserLayout still uses mandatoryAuthenticatorGuard on canActivate (wrong)")
    if "canActivate: [deepLinkGuard(), authGuard, mandatoryAuthenticatorActivate]" in text:
        raise RuntimeError(f"{path}: UserLayout still runs mandatory guard before shell activation")
    if "canActivate: [mandatoryAuthenticatorActivate, setupExtensionRedirectGuard]" in text:
        raise RuntimeError(f"{path}: vault route still runs mandatory guard before setup-extension guard")
    if 'path: "settings",\n        canActivateChild: [mandatoryAuthenticatorGuard]' in text:
        raise RuntimeError(f"{path}: settings route has duplicate mandatory child guard")

    setup_match = re.search(
        r'path: "setup-extension",\n(?P<body>[\s\S]*?)(?=\n\s*\},)',
        text,
    )
    if not setup_match:
        raise RuntimeError(f"{path}: setup-extension route not found")

    setup_body = setup_match.group("body")
    if len(re.findall(r"\bcanActivate\s*:", setup_body)) != 1:
        raise RuntimeError(f"{path}: setup-extension route must contain exactly one canActivate")

    can_activate_match = re.search(r"canActivate: \[(?P<guards>[^\]]*)\]", setup_body)
    if not can_activate_match:
        raise RuntimeError(f"{path}: setup-extension route canActivate not found")

    guards = [guard.strip() for guard in can_activate_match.group("guards").split(",") if guard.strip()]
    duplicates = sorted({guard for guard in guards if guards.count(guard) > 1})
    if duplicates:
        raise RuntimeError(
            f"{path}: setup-extension route has duplicate canActivate guards: {', '.join(duplicates)}"
        )

    if "blockSetupExtensionUntilMandatory2faGuard" not in guards:
        raise RuntimeError(f"{path}: setup-extension route missing mandatory 2FA guard")


def main() -> int:
    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"ERROR: missing {path}")
    apply_mandatory_routing(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
