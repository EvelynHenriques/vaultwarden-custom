#!/usr/bin/env python3
"""Skip logout on vaultwarden mandatory Authenticator 2FA 403 responses in ApiService."""

from __future__ import annotations

import re
import sys
from pathlib import Path

MARKER = "EBvault mandatory Authenticator 2FA gate"

METHOD_START = "  private async handleApiRequestError("
METHOD_NEXT = "  private async handleTokenRefreshRequestError("

ORIGINAL = """  private async handleApiRequestError(
    response: Response,
    userIsAuthenticated: boolean,
  ): Promise<ErrorResponse> {
    if (
      userIsAuthenticated &&
      (response.status === HttpStatusCode.Unauthorized ||
        response.status === HttpStatusCode.Forbidden)
    ) {
      await this.logoutCallback("invalidAccessToken");
    }

    const responseJson = await this.getJsonResponse(response);
    return new ErrorResponse(responseJson, response.status);
  }"""

# Inline check only — never insert a standalone function inside ApiService.
PATCHED = f"""  private async handleApiRequestError(
    response: Response,
    userIsAuthenticated: boolean,
  ): Promise<ErrorResponse> {{
    const responseJson = await this.getJsonResponse(response);

    // {MARKER}: keep the session alive when the server blocks vault APIs for missing Authenticator 2FA.
    if (userIsAuthenticated && response.status === HttpStatusCode.Forbidden) {{
      const payload = responseJson as {{
        Message?: string;
        message?: string;
        errorModel?: {{ message?: string }};
        validationErrors?: Record<string, string[]>;
      }};
      const validationMessages = payload?.validationErrors?.[""];
      const validationText = Array.isArray(validationMessages) ? validationMessages.join(" ") : "";
      const errorMessage = String(
        payload?.Message ?? payload?.message ?? payload?.errorModel?.message ?? "",
      );
      const combined = `${{errorMessage}} ${{validationText}}`;
      if (
        combined.includes("Authenticator app setup is required") ||
        combined.includes("User must configure Authenticator 2FA")
      ) {{
        return new ErrorResponse(responseJson, response.status);
      }}
    }}

    if (
      userIsAuthenticated &&
      (response.status === HttpStatusCode.Unauthorized ||
        response.status === HttpStatusCode.Forbidden)
    ) {{
      await this.logoutCallback("invalidAccessToken");
    }}

    return new ErrorResponse(responseJson, response.status);
  }}"""

HELPER_FN_PATTERN = re.compile(
    r"function extractMandatoryAuthenticatorSetupMessage\([\s\S]*?\n\}\n\n",
    re.MULTILINE,
)


def remove_broken_helper(text: str) -> tuple[str, bool]:
    if "function extractMandatoryAuthenticatorSetupMessage" not in text:
        return text, False
    new_text, count = HELPER_FN_PATTERN.subn("", text, count=1)
    return new_text, count > 0


def replace_handle_api_request_error(text: str) -> str | None:
    start = text.find(METHOD_START)
    if start == -1:
        return None
    next_anchor = text.find(METHOD_NEXT, start)
    if next_anchor == -1:
        return None
    return text[:start] + PATCHED + "\n\n" + text[next_anchor:]


def has_valid_patch(text: str) -> bool:
    return (
        MARKER in text
        and "function extractMandatoryAuthenticatorSetupMessage" not in text
        and "extractMandatoryAuthenticatorSetupMessage(" not in text
        and METHOD_START in text
    )


def apply_api_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original_text = text

    text, removed_helper = remove_broken_helper(text)

    if has_valid_patch(text) and not removed_helper:
        print(f"  mandatory 2FA API patch already applied in {path.name}")
        return False

    if ORIGINAL in text:
        text = text.replace(ORIGINAL, PATCHED, 1)
    else:
        replaced = replace_handle_api_request_error(text)
        if replaced is None:
            raise RuntimeError(
                f"{path}: could not locate handleApiRequestError to patch or repair — "
                "Bitwarden clients version may have changed"
            )
        text = replaced

    text, _ = remove_broken_helper(text)

    if not has_valid_patch(text):
        raise RuntimeError(f"{path}: mandatory 2FA API patch failed validation after apply")

    if text != original_text:
        path.write_text(text, encoding="utf-8")
        action = "repaired" if removed_helper or MARKER in original_text else "updated"
        print(f"  {action} mandatory 2FA API error handling in {path.name}")
        return True

    print(f"  mandatory 2FA API patch already applied in {path.name}")
    return False


def main() -> int:
    clients_dir = Path(sys.argv[1])
    api_path = clients_dir / "libs/common/src/services/api.service.ts"
    if not api_path.is_file():
        raise SystemExit(f"ERROR: missing {api_path}")
    apply_api_patch(api_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
