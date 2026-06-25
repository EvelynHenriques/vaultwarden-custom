#!/usr/bin/env python3
"""Defer post-login fullSync so mandatory 2FA gate can run before vault sync."""

from __future__ import annotations

import sys
from pathlib import Path

MARKER = "EBvault defer post-login fullSync to mandatory 2FA gate"

ORIGINAL = """  async run(userId: UserId, masterPassword: string | null): Promise<void> {
    await this.syncService.fullSync(true, { skipTokenRefresh: true });
    await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);"""

OLD_PATCHED = f"""  async run(userId: UserId, masterPassword: string | null): Promise<void> {{
    try {{
      await this.syncService.fullSync(true, {{ skipTokenRefresh: true }});
    }} catch (error) {{
      // {MARKER}: UserLayout runs fullSync after mandatory 2FA gate on self-host.
      // Login navigation must not fail when sync is blocked or deferred.
      this.logService.debug("Deferred post-login fullSync to mandatory 2FA gate", error);
    }}
    await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);"""

PATCHED = f"""  async run(userId: UserId, masterPassword: string | null): Promise<void> {{
    try {{
      await this.syncService.fullSync(true, {{ skipTokenRefresh: true }});
    }} catch (error: unknown) {{
      // {MARKER}: UserLayout runs fullSync after mandatory 2FA gate on self-host.
      const errorMessage =
        typeof error === "object" && error != null && "message" in error
          ? String((error as {{ message?: string }}).message ?? "")
          : String(error ?? "");
      const isExpectedMandatoryDefer =
        errorMessage.includes("Authenticator app setup is required") ||
        errorMessage.includes("User must configure Authenticator 2FA");
      if (isExpectedMandatoryDefer) {{
        this.logService.debug(
          "[EBvault] Post-login fullSync deferred until mandatory 2FA gate resolves (expected).",
        );
      }} else {{
        this.logService.warning(
          "[EBvault] Post-login fullSync failed; UserLayout will retry after mandatory 2FA gate.",
          error,
        );
      }}
    }}
    await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);"""


def apply_defer_login_sync_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    if MARKER in text and OLD_PATCHED in text:
        text = text.replace(OLD_PATCHED, PATCHED, 1)
        path.write_text(text, encoding="utf-8")
        print(f"  upgraded post-login fullSync logging in {path.name}")
        return True

    if MARKER in text:
        print(f"  defer login sync patch already applied in {path.name}")
        return False

    if ORIGINAL not in text:
        raise RuntimeError(
            f"{path}: could not find DefaultLoginSuccessHandlerService.run fullSync block — "
            "Bitwarden clients version may have changed"
        )

    text = text.replace(ORIGINAL, PATCHED, 1)
    path.write_text(text, encoding="utf-8")
    print(f"  updated post-login fullSync handling in {path.name}")
    return text != original


def main() -> int:
    clients_dir = Path(sys.argv[1])
    handler_path = (
        clients_dir
        / "libs/auth/src/common/services/login-success-handler/default-login-success-handler.service.ts"
    )
    if not handler_path.is_file():
        raise SystemExit(f"ERROR: missing {handler_path}")
    apply_defer_login_sync_patch(handler_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
