#!/usr/bin/env python3
"""Verify generated Web Vault mandatory-2FA login flow patches."""

from __future__ import annotations

import sys
from pathlib import Path

CHECKS = (
    "navigation to /vault started",
    "navigateToVault",
    "router.navigate",
    "router.navigateByUrl",
    "/vault",
    "DefaultLoginSuccessHandlerService",
    "void userId",
    "void masterPassword",
    "login-time fullSync deferred",
    "sync deferred without throwing during login bootstrap",
)

LOGIN_HANDLER = (
    "libs/auth/src/common/services/login-success-handler/"
    "default-login-success-handler.service.ts"
)

EXPECTED_LOGIN_MARKERS = (
    "[EBvault LOGIN] DefaultLoginSuccessHandlerService.run started",
    "[EBvault LOGIN] auth state stable",
    "[EBvault LOGIN] original post-login bootstrap completed",
    "[EBvault LOGIN] DefaultLoginSuccessHandlerService.run completed",
)

BAD_LOGIN_MARKERS = (
    "void userId;",
    "void masterPassword;",
    "Post-login bootstrap skipped",
    "EBvault defer post-login bootstrap to mandatory 2FA gate",
)

OSS_ROUTING = "apps/web/src/app/oss-routing.module.ts"


def print_matches(clients_dir: Path) -> None:
    print("  generated source search results:")
    for path in clients_dir.rglob("*.ts"):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        matches = [needle for needle in CHECKS if needle in text]
        if not matches:
            continue
        rel = path.relative_to(clients_dir)
        print(f"    {rel}: {', '.join(matches)}")


def verify_login_handler(clients_dir: Path) -> None:
    handler = clients_dir / LOGIN_HANDLER
    if not handler.is_file():
        raise RuntimeError(f"missing generated login success handler: {handler}")

    text = handler.read_text(encoding="utf-8")
    missing = [marker for marker in EXPECTED_LOGIN_MARKERS if marker not in text]
    if missing:
        raise RuntimeError(
            f"{handler}: DefaultLoginSuccessHandlerService.run was not patched; "
            f"missing markers: {', '.join(missing)}"
        )

    bad = [marker for marker in BAD_LOGIN_MARKERS if marker in text]
    if bad:
        raise RuntimeError(
            f"{handler}: old broken login bootstrap patch is still present: {', '.join(bad)}"
        )

    print("  verified generated DefaultLoginSuccessHandlerService.run markers")


def verify_no_ebvault_vault_navigation_log(clients_dir: Path) -> None:
    offenders = []
    for path in clients_dir.rglob("*.ts"):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if "navigation to /vault started" in text:
            offenders.append(path.relative_to(clients_dir))

    if offenders:
        raise RuntimeError(
            "EBvault /2fa -> /vault navigation observer log is still present in generated files: "
            + ", ".join(str(path) for path in offenders)
        )

    print("  verified no EBvault 'navigation to /vault started' generated log")


def print_routing_context(clients_dir: Path) -> None:
    routing = clients_dir / OSS_ROUTING
    if not routing.is_file():
        print(f"  warning: generated routing module not found: {routing}")
        return

    lines = routing.read_text(encoding="utf-8").splitlines()
    text = "\n".join(lines)
    if "useHash: true" in text:
        print("  verified generated Web Vault routing uses hash URLs (useHash: true)")
    else:
        print("  warning: generated Web Vault routing did not show useHash: true")

    print("  generated mandatory 2FA routing context:")
    for label, needle in (
        ("vault route", 'path: "vault"'),
        ("settings route", 'path: "settings"'),
        ("setup-extension route", 'path: "setup-extension"'),
        ("UserLayout route", "component: UserLayoutComponent"),
    ):
        matches = [index for index, line in enumerate(lines) if needle in line]
        if not matches:
            print(f"    {label}: not found")
            continue
        for index in matches:
            start = max(0, index - 4)
            end = min(len(lines), index + 12)
            print(f"    {label} around line {index + 1}:")
            for line_no in range(start, end):
                print(f"      {line_no + 1}: {lines[line_no]}")

    print("  generated mandatoryAuthenticatorActivate occurrences:")
    for index, line in enumerate(lines):
        if "mandatoryAuthenticatorActivate" not in line:
            continue
        start = max(0, index - 5)
        path_hint = next(
            (
                lines[line_no].strip()
                for line_no in range(index, start - 1, -1)
                if "path:" in lines[line_no] or "component:" in lines[line_no]
            ),
            "(no nearby path/component)",
        )
        print(f"    line {index + 1}: {line.strip()} near {path_hint}")


def main() -> int:
    clients_dir = Path(sys.argv[1])
    if not clients_dir.is_dir():
        raise SystemExit(f"ERROR: clients directory not found: {clients_dir}")

    print_matches(clients_dir)
    print_routing_context(clients_dir)
    verify_login_handler(clients_dir)
    verify_no_ebvault_vault_navigation_log(clients_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
