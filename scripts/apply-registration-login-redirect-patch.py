#!/usr/bin/env python3
"""Keep upstream registration, but redirect to login after password setup."""

from __future__ import annotations

import sys
from pathlib import Path

START_EMAIL_ANCHOR = (
    "    const result = await this.accountApiService.registerSendVerificationEmail(request);"
)
START_EMAIL_LOG = '    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBcofre ACCOUNT] email submitted for verification");'
START_VERIFY_ANCHOR = "    this.state = RegistrationStartState.CHECK_EMAIL;"
START_VERIFY_LOG = '    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBcofre ACCOUNT] verify email screen shown");'

FINISH_LINK_ANCHOR = "      await this.initEmailVerificationFlow();"
FINISH_LINK_OPENED_LOG = '      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBcofre ACCOUNT] verification link opened");'
FINISH_SET_PASSWORD_LOG = '      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBcofre ACCOUNT] set password screen loaded");'

FINISH_SUCCESS_MARKER = "[EBcofre ACCOUNT] redirecting to login after password setup"

FINISH_REPLACEMENT = """    // Show acct created toast
    this.toastService.showToast({
      variant: "success",
      title: null,
      message: this.i18nService.t("newAccountCreated2"),
    });

    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBcofre ACCOUNT] password defined successfully");
    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBcofre ACCOUNT] redirecting to login after password setup");
    await this.router.navigate(["/login"], { queryParams: { email: this.email } });
    this.submitting = false;"""

FINISH_UNUSED_REPLACEMENTS = [
    (
        """import { PremiumInterestStateService } from "@bitwarden/angular/billing/services/premium-interest/premium-interest-state.service.abstraction";
""",
        "",
    ),
    ('import { LogService } from "@bitwarden/common/platform/abstractions/log.service";\n', ""),
    (
        """import {
  LoginStrategyServiceAbstraction,
  LoginSuccessHandlerService,
  PasswordLoginCredentials,
} from "../../../common";
""",
        "",
    ),
    ("    private loginStrategyService: LoginStrategyServiceAbstraction,\n", ""),
    ("    private logService: LogService,\n", ""),
    ("    private loginSuccessHandlerService: LoginSuccessHandlerService,\n", ""),
    ("    private premiumInterestStateService: PremiumInterestStateService,\n", ""),
]


def insert_before_once(text: str, anchor: str, insertion: str, path: Path) -> str:
    if insertion in text:
        return text
    if anchor not in text:
        raise RuntimeError(f"{path}: could not find anchor for {insertion}")
    return text.replace(anchor, f"{insertion}\n{anchor}", 1)


def insert_around_once(text: str, anchor: str, before: str, after: str, path: Path) -> str:
    if before in text and after in text:
        return text
    if anchor not in text:
        raise RuntimeError(f"{path}: could not find email verification flow anchor")
    replacement = f"{before}\n{anchor}\n{after}"
    return text.replace(anchor, replacement, 1)


def patch_registration_start(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    text = insert_before_once(text, START_EMAIL_ANCHOR, START_EMAIL_LOG, path)
    text = insert_before_once(text, START_VERIFY_ANCHOR, START_VERIFY_LOG, path)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  updated EBcofre registration start logs in {path.name}")
        return True

    print(f"  EBcofre registration start logs already applied in {path.name}")
    return False


def patch_registration_finish(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    text = insert_around_once(
        text,
        FINISH_LINK_ANCHOR,
        FINISH_LINK_OPENED_LOG,
        FINISH_SET_PASSWORD_LOG,
        path,
    )

    if FINISH_SUCCESS_MARKER not in text:
        block_start = text.find("    // Show acct created toast")
        if block_start == -1:
            raise RuntimeError(f"{path}: could not find account-created toast block")

        submit_done = "    this.submitting = false;"
        block_end = text.find(submit_done, block_start)
        if block_end == -1:
            raise RuntimeError(f"{path}: could not find registration submit completion")
        block_end += len(submit_done)

        text = text[:block_start] + FINISH_REPLACEMENT + text[block_end:]

    for old, new in FINISH_UNUSED_REPLACEMENTS:
        text = text.replace(old, new)

    if FINISH_SUCCESS_MARKER not in text:
        raise RuntimeError(f"{path}: registration login redirect patch failed validation")

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  updated EBcofre registration finish redirect in {path.name}")
        return True

    print(f"  EBcofre registration finish redirect already applied in {path.name}")
    return False


def main() -> int:
    clients_dir = Path(sys.argv[1])
    if not clients_dir.is_dir():
        raise SystemExit(f"ERROR: clients directory not found: {clients_dir}")

    start_path = (
        clients_dir
        / "libs/auth/src/angular/registration/registration-start/registration-start.component.ts"
    )
    finish_path = (
        clients_dir
        / "libs/auth/src/angular/registration/registration-finish/registration-finish.component.ts"
    )
    for path in [start_path, finish_path]:
        if not path.is_file():
            raise SystemExit(f"ERROR: missing {path}")

    patch_registration_start(start_path)
    patch_registration_finish(finish_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
