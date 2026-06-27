#!/usr/bin/env python3
"""Fix login-time 2FA submit: clear loading state and surface identity 400 errors."""

from __future__ import annotations

import sys
from pathlib import Path

MARKER = "EBvault login 2FA submit error handling"
IMPORT_MARKER = "EBvault login 2FA ErrorResponse import"
REMEMBER_MARKER = "EBvault remember device disabled"

ERROR_RESPONSE_IMPORT = (
    'import { ErrorResponse } from "@bitwarden/common/models/response/error.response";\n'
)

ORIGINAL_CATCH = """    } catch {
      this.logService.error("Error submitting two factor token");
      this.toastService.showToast({
        variant: "error",
        title: this.i18nService.t("errorOccurred"),
        message: this.i18nService.t("invalidVerificationCode"),
      });
    }
  };"""

PATCHED_CATCH = f"""    }} catch (error: unknown) {{
      this.logService.error("Error submitting two factor token", error as any);
      let message = this.i18nService.t("invalidVerificationCode");
      if (error instanceof ErrorResponse) {{
        message = error.message || message;
      }}
      this.toastService.showToast({{
        variant: "error",
        title: this.i18nService.t("errorOccurred"),
        message,
      }});
    }} finally {{
      // {MARKER}: release bitAction loading state after identity /connect/token completes.
      this.formPromise = undefined;
    }}
  }};"""


def apply_login_two_factor_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    changed = False

    if IMPORT_MARKER not in text:
        anchor = 'import { LogService } from "@bitwarden/common/platform/abstractions/log.service";'
        if anchor not in text:
            raise RuntimeError(
                f"{path}: could not find LogService import anchor — Bitwarden clients version may have changed"
            )
        text = text.replace(
            anchor,
            anchor + "\n" + ERROR_RESPONSE_IMPORT.rstrip() + f" // {IMPORT_MARKER}",
            1,
        )
        changed = True

    if MARKER in text:
        if not changed:
            print(f"  login 2FA submit patch already applied in {path.name}")
        return changed

    if ORIGINAL_CATCH not in text:
        raise RuntimeError(
            f"{path}: could not find two-factor-auth submit catch block — "
            "Bitwarden clients version may have changed"
        )

    text = text.replace(ORIGINAL_CATCH, PATCHED_CATCH, 1)
    path.write_text(text, encoding="utf-8")
    print(f"  updated login 2FA submit error handling in {path.name}")
    return True


def apply_remember_device_ts_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    if REMEMBER_MARKER not in text:
        remember_line = (
            "    const rememberValue = remember ?? this.rememberFormControl.value ?? false;"
        )
        if remember_line not in text:
            raise RuntimeError(
                f"{path}: could not find rememberValue assignment — Bitwarden clients version may have changed"
            )
        text = text.replace(
            remember_line,
            f"""    // {REMEMBER_MARKER}: EBvault requires TOTP every login.
    void remember;
    const rememberValue = false;
    console.log("[EBvault 2FA] remember device option disabled");""",
            1,
        )

    cache_line = "        this.form.patchValue({ remember: cachedData.remember });"
    if cache_line in text:
        text = text.replace(cache_line, "        this.form.patchValue({ remember: false });", 1)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  disabled remember-device submit state in {path.name}")
        return True

    print(f"  remember-device submit state already disabled in {path.name}")
    return False


def apply_remember_device_html_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    remember_block = """    <bit-form-control *ngIf="!hideRememberMe()">
      <bit-label>{{ "dontAskAgainOnThisDeviceFor30Days" | i18n }}</bit-label>
      <input type="checkbox" bitCheckbox formControlName="remember" (change)="onRememberChange()" />
    </bit-form-control>

"""
    text = text.replace(remember_block, "")
    text = text.replace(
        '(webAuthnResultEmitter)="submit($event.token, $event.remember)"',
        '(webAuthnResultEmitter)="submit($event.token, false)"',
    )

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  removed remember-device checkbox in {path.name}")
        return True

    print(f"  remember-device checkbox already removed in {path.name}")
    return False


def main() -> int:
    clients_dir = Path(sys.argv[1])
    component_path = (
        clients_dir / "libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts"
    )
    template_path = (
        clients_dir / "libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html"
    )
    if not component_path.is_file():
        raise SystemExit(f"ERROR: missing {component_path}")
    if not template_path.is_file():
        raise SystemExit(f"ERROR: missing {template_path}")
    apply_login_two_factor_patch(component_path)
    apply_remember_device_ts_patch(component_path)
    apply_remember_device_html_patch(template_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
