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
    "[EBcofre LOGIN] DefaultLoginSuccessHandlerService.run started",
    "[EBcofre LOGIN] auth state stable",
    "EBVAULT_MANDATORY_2FA_GATE_PROMISE",
    "EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT",
    "[EBcofre LOGIN] mandatory no-TOTP gate check starting before default navigation",
    "[EBcofre LOGIN] default /vault navigation skipped because mandatory setup is required",
    "[EBcofre LOGIN] original post-login bootstrap completed",
    "[EBcofre LOGIN] DefaultLoginSuccessHandlerService.run completed",
)

BAD_LOGIN_MARKERS = (
    "void userId;",
    "void masterPassword;",
    "Post-login bootstrap skipped",
    "EBcofre defer post-login bootstrap to mandatory 2FA gate",
    "mandatory gate resolved before default navigation",
)

OSS_ROUTING = "apps/web/src/app/oss-routing.module.ts"
LOGIN_COMPONENT = "libs/auth/src/angular/login/login.component.ts"
DEEP_LINK_GUARD = "apps/web/src/app/auth/guards/deep-link/deep-link.guard.ts"
AUTH_GUARD = "libs/angular/src/auth/guards/auth.guard.ts"
TWO_FACTOR_COMPONENT = "libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts"
TWO_FACTOR_TEMPLATE = "libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html"


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


def verify_no_ebcofre_vault_navigation_log(clients_dir: Path) -> None:
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
            "EBcofre /2fa -> /vault navigation observer log is still present in generated files: "
            + ", ".join(str(path) for path in offenders)
        )

    print("  verified no EBcofre 'navigation to /vault started' generated log")


def verify_password_login_redirect(clients_dir: Path) -> None:
    component = clients_dir / LOGIN_COMPONENT
    if not component.is_file():
        raise RuntimeError(f"missing generated password login component: {component}")

    text = component.read_text(encoding="utf-8")
    expected = (
        "EBcofre mandatory setup redirect after no-TOTP gate",
        "EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT",
        "[EBcofre LOGIN] deferred mandatory setup navigation starting",
        "[EBcofre SETUP ROUTE] setup navigation promise created",
        "[EBcofre SETUP ROUTE] setup navigation still pending after 2s",
        "[EBcofre SETUP ROUTE] setup navigation promise resolved true",
        "[EBcofre SETUP ROUTE] setup navigation promise rejected",
        "[EBcofre LOGIN] mandatory setup navigation completed",
        "[EBcofre LOGIN] mandatory setup navigation failed",
        "this.router.navigateByUrl(",
    )
    missing = [marker for marker in expected if marker not in text]
    if missing:
        raise RuntimeError(
            f"{component}: password login can still continue to default vault navigation: "
            + ", ".join(missing)
        )

    redirect_index = text.find("EBcofre mandatory setup redirect after no-TOTP gate")
    default_vault_index = text.find('this.router.navigate(["vault"])')
    if default_vault_index != -1 and redirect_index > default_vault_index:
        raise RuntimeError(
            f"{component}: mandatory setup redirect is after the default vault navigation"
        )

    print("  verified password login skips default vault navigation when mandatory setup is required")


def verify_deep_link_guard_suppresses_setup_required_vault_restore(clients_dir: Path) -> None:
    guard = clients_dir / DEEP_LINK_GUARD
    if not guard.is_file():
        raise RuntimeError(f"missing generated deep-link guard: {guard}")

    text = guard.read_text(encoding="utf-8")
    expected = (
        "EBcofre mandatory setup suppresses deep-link vault restore",
        "EBVAULT_MANDATORY_2FA_GATE_DECISION",
        'ebcofreMandatoryGateDecision?.kind === "setup_required"',
        "[EBcofre DEBUG] /vault navigation source suppressed: deepLinkGuard persisted login redirect",
        "[EBcofre 2FA SETUP] setup route allowed after suppressing stale protected destination",
        'return router.createUrlTree(["/settings/security/two-factor"]);',
    )
    missing = [marker for marker in expected if marker not in text]
    if missing:
        raise RuntimeError(
            f"{guard}: no-TOTP setup navigation can still be cancelled by a stale /vault deep link: "
            + ", ".join(missing)
        )

    print("  verified deepLinkGuard suppresses stale /vault restore during mandatory setup")


def verify_auth_guard_allows_mandatory_setup_route(clients_dir: Path) -> None:
    guard = clients_dir / AUTH_GUARD
    if not guard.is_file():
        raise RuntimeError(f"missing generated auth guard: {guard}")

    text = guard.read_text(encoding="utf-8")
    expected = (
        "EBcofre mandatory setup bypasses authGuard force-state checks",
        "EBVAULT_MANDATORY_2FA_GATE_DECISION",
        'ebcofreMandatoryGateDecision?.kind === "setup_required"',
        "[EBcofre AUTH GUARD] mandatory setup route allowed immediately",
        "authStatus !== AuthenticationStatus.LoggedOut",
    )
    missing = [marker for marker in expected if marker not in text]
    if missing:
        raise RuntimeError(
            f"{guard}: mandatory setup route can still wait behind upstream authGuard state: "
            + ", ".join(missing)
        )

    print("  verified authGuard allows mandatory setup route without vault-state waits")


def verify_lock_guard(clients_dir: Path) -> None:
    routing = clients_dir / OSS_ROUTING
    if not routing.is_file():
        raise RuntimeError(f"missing generated routing module: {routing}")

    text = routing.read_text(encoding="utf-8")
    if "mandatoryFullReloginLockGuard" not in text:
        raise RuntimeError(f"{routing}: generated /lock route is missing mandatoryFullReloginLockGuard")
    if "canActivate: [deepLinkGuard(), mandatoryFullReloginLockGuard, lockGuard()]" not in text:
        raise RuntimeError(f"{routing}: generated /lock route does not force EBcofre full re-login first")

    print("  verified generated /lock route forces full re-login before local lock guard")


def verify_remember_device_disabled(clients_dir: Path) -> None:
    component = clients_dir / TWO_FACTOR_COMPONENT
    template = clients_dir / TWO_FACTOR_TEMPLATE
    if not component.is_file():
        raise RuntimeError(f"missing generated 2FA component: {component}")
    if not template.is_file():
        raise RuntimeError(f"missing generated 2FA template: {template}")

    component_text = component.read_text(encoding="utf-8")
    template_text = template.read_text(encoding="utf-8")

    expected = (
        "EBcofre remember device disabled",
        "const rememberValue = false;",
        'this.form.patchValue({ remember: false });',
    )
    missing = [marker for marker in expected if marker not in component_text]
    if missing:
        raise RuntimeError(
            f"{component}: remember-device submit path is not fully disabled: {', '.join(missing)}"
        )

    if "dontAskAgainOnThisDeviceFor30Days" in template_text:
        raise RuntimeError(f"{template}: remember-device checkbox is still rendered")
    if 'submit($event.token, $event.remember)' in template_text:
        raise RuntimeError(f"{template}: WebAuthn can still submit remember=true")

    print("  verified remember-device checkbox and submit state are disabled")


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
    verify_no_ebcofre_vault_navigation_log(clients_dir)
    verify_password_login_redirect(clients_dir)
    verify_deep_link_guard_suppresses_setup_required_vault_restore(clients_dir)
    verify_auth_guard_allows_mandatory_setup_route(clients_dir)
    verify_lock_guard(clients_dir)
    verify_remember_device_disabled(clients_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
