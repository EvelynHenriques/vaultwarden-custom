#!/usr/bin/env python3
"""Skip logout on vaultwarden mandatory Authenticator 2FA 403 responses in ApiService."""

from __future__ import annotations

import sys
from pathlib import Path

MARKER = "EBvault mandatory Authenticator 2FA gate"

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

PATCHED = f"""  private async handleApiRequestError(
    response: Response,
    userIsAuthenticated: boolean,
  ): Promise<ErrorResponse> {{
    const responseJson = await this.getJsonResponse(response);

    // {MARKER}: keep the session alive when the server blocks vault APIs for missing Authenticator 2FA.
    if (userIsAuthenticated && response.status === HttpStatusCode.Forbidden) {{
      const errorMessage = String(
        responseJson?.Message ?? responseJson?.message ?? "",
      );
      if (errorMessage.includes("Authenticator app setup is required") || errorMessage.includes("User must configure Authenticator 2FA")) {{
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


def apply_api_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    if MARKER in text:
        old_check = 'if (errorMessage.includes("Authenticator app setup is required")) {'
        new_check = (
            'if (errorMessage.includes("Authenticator app setup is required") '
            '|| errorMessage.includes("User must configure Authenticator 2FA")) {'
        )
        if old_check in text and new_check not in text:
            text = text.replace(old_check, new_check, 1)
            path.write_text(text, encoding="utf-8")
            print(f"  updated mandatory 2FA error message matching in {path.name}")
            return True
        print(f"  mandatory 2FA API patch already applied in {path.name}")
        return False

    if ORIGINAL not in text:
        raise RuntimeError(
            f"{path}: could not find handleApiRequestError block to patch — "
            "Bitwarden clients version may have changed"
        )

    text = text.replace(ORIGINAL, PATCHED, 1)
    path.write_text(text, encoding="utf-8")
    print(f"  updated mandatory 2FA API error handling in {path.name}")
    return text != original


def main() -> int:
    clients_dir = Path(sys.argv[1])
    api_path = clients_dir / "libs/common/src/services/api.service.ts"
    if not api_path.is_file():
        raise SystemExit(f"ERROR: missing {api_path}")
    apply_api_patch(api_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
