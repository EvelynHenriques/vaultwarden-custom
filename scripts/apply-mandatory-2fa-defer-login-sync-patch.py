#!/usr/bin/env python3
"""Keep the upstream login-success lifecycle, but do not let pre-gate sync abort it."""

from __future__ import annotations

import sys
from pathlib import Path

MARKER = "EBvault defer login-time fullSync during mandatory 2FA gate"
PREVIOUS_GUARD_MARKER = "EBvault guard login-time fullSync during mandatory 2FA gate"
LEGACY_FULLSYNC_MARKER = "EBvault defer post-login fullSync to mandatory 2FA gate"
LEGACY_BOOTSTRAP_MARKER = "EBvault defer post-login bootstrap to mandatory 2FA gate"

RUN_SIGNATURE = "  async run(userId: UserId, masterPassword: string | null): Promise<void> {"
ORIGINAL_PREFIX = f"""{RUN_SIGNATURE}
    await this.syncService.fullSync(true, {{ skipTokenRefresh: true }});
    await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);"""

REGEN_LINE = "    await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);"
REGEN_BLOCK = """    console.log("[EBvault LOGIN] before key regeneration");
    try {
      await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);
      console.log("[EBvault LOGIN] after key regeneration");
    } catch (error: unknown) {
      console.log("[EBvault LOGIN] key regeneration failed", error);
      throw error;
    }"""

PATCHED_PREFIX = f"""{RUN_SIGNATURE}
    console.log("[EBvault LOGIN] DefaultLoginSuccessHandlerService.run started");
    console.log("[EBvault LOGIN] auth state stable");
    // {MARKER}: keep upstream sync for real TOTP logins, but avoid /api/sync before setup.
    const ebvaultCurrentFlowPassedTotp =
      (globalThis as {{ EBVAULT_CURRENT_AUTH_FLOW_PASSED_TOTP?: boolean }})
        .EBVAULT_CURRENT_AUTH_FLOW_PASSED_TOTP === true;
    if (ebvaultCurrentFlowPassedTotp) {{
      await this.syncService.fullSync(true, {{ skipTokenRefresh: true }});
      console.log("[EBvault LOGIN] upstream login-time fullSync completed after TOTP");
    }} else {{
      console.log("[EBvault 2FA] sync deferred without throwing during login bootstrap");
    }}
    console.log("[EBvault LOGIN] original post-login bootstrap completed");
{REGEN_BLOCK}"""

COMPLETION_LOG = '    console.log("[EBvault LOGIN] DefaultLoginSuccessHandlerService.run completed");'


def find_matching_brace(text: str, open_brace_index: int) -> int:
    depth = 0
    for index in range(open_brace_index, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    raise RuntimeError("could not find end of DefaultLoginSuccessHandlerService.run")


def get_run_method_bounds(text: str) -> tuple[int, int]:
    start = text.find(RUN_SIGNATURE)
    if start == -1:
        raise RuntimeError(
            "could not find DefaultLoginSuccessHandlerService.run signature — "
            "Bitwarden clients version may have changed"
        )

    open_brace = text.find("{", start)
    if open_brace == -1:
        raise RuntimeError("could not find DefaultLoginSuccessHandlerService.run opening brace")

    end = find_matching_brace(text, open_brace)
    return start, end + 1


def remove_legacy_early_return(run_method: str) -> str:
    if LEGACY_BOOTSTRAP_MARKER not in run_method:
        return run_method

    return_index = run_method.find("    return;")
    if return_index == -1:
        raise RuntimeError("legacy EBvault bootstrap skip marker found but return statement was not found")

    after_return = run_method.find("\n", return_index)
    if after_return == -1:
        raise RuntimeError("legacy EBvault bootstrap skip return is malformed")

    patched_body = PATCHED_PREFIX.replace(RUN_SIGNATURE + "\n", "")
    return RUN_SIGNATURE + "\n" + patched_body + run_method[after_return + 1 :]


def patch_run_method(text: str) -> str:
    if MARKER in text and LEGACY_BOOTSTRAP_MARKER not in text:
        start, end = get_run_method_bounds(text)
        run_method = ensure_completion_log(upgrade_regeneration_logging(text[start:end]))
        return text[:start] + run_method + text[end:]

    if ORIGINAL_PREFIX in text:
        text = text.replace(ORIGINAL_PREFIX, PATCHED_PREFIX, 1)
        start, end = get_run_method_bounds(text)
        run_method = ensure_completion_log(text[start:end])
        return text[:start] + run_method + text[end:]

    start, end = get_run_method_bounds(text)
    original_run_method = text[start:end]
    run_method = remove_legacy_early_return(original_run_method)
    if run_method != original_run_method:
        run_method = ensure_completion_log(run_method)
        return text[:start] + run_method + text[end:]

    legacy_prefixes = []
    legacy_try_start = run_method.find("    try {\n      await this.syncService.fullSync")
    legacy_regen = "    await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);"
    if legacy_try_start != -1 and (
        LEGACY_FULLSYNC_MARKER in run_method or PREVIOUS_GUARD_MARKER in run_method
    ):
        legacy_regen_index = run_method.find(legacy_regen, legacy_try_start)
        if legacy_regen_index == -1:
            raise RuntimeError("legacy fullSync patch found but regeneration anchor was not found")
        legacy_prefixes.append((legacy_try_start, legacy_regen_index + len(legacy_regen)))

    if legacy_prefixes:
        prefix_start, prefix_end = legacy_prefixes[0]
        patched_method = (
            run_method[:prefix_start]
            + PATCHED_PREFIX.replace(RUN_SIGNATURE + "\n", "")
            + run_method[prefix_end:]
        )
        patched_method = ensure_completion_log(patched_method)
        return text[:start] + patched_method + text[end:]

    if MARKER in run_method:
        patched_method = ensure_completion_log(run_method)
        return text[:start] + patched_method + text[end:]

    raise RuntimeError(
        "could not find DefaultLoginSuccessHandlerService.run fullSync block to patch — "
        "Bitwarden clients version may have changed"
    )


def ensure_completion_log(run_method: str) -> str:
    if COMPLETION_LOG in run_method:
        return run_method

    closing_brace_index = run_method.rfind("\n  }")
    if closing_brace_index == -1:
        raise RuntimeError("could not find DefaultLoginSuccessHandlerService.run closing brace")

    return run_method[:closing_brace_index] + "\n" + COMPLETION_LOG + run_method[closing_brace_index:]


def upgrade_regeneration_logging(run_method: str) -> str:
    if "[EBvault LOGIN] before key regeneration" in run_method:
        return run_method
    if REGEN_LINE not in run_method:
        return run_method
    return run_method.replace(REGEN_LINE, REGEN_BLOCK, 1)


def apply_defer_login_sync_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    patched = patch_run_method(text)

    if patched == text:
        print(f"  login success handler already preserves upstream lifecycle in {path.name}")
        return False

    if LEGACY_BOOTSTRAP_MARKER in patched:
        raise RuntimeError(f"{path}: legacy early-return login bootstrap patch was not fully removed")
    if 'void userId;' in patched or 'void masterPassword;' in patched:
        raise RuntimeError(f"{path}: login success handler still contains early-return bootstrap remnants")

    path.write_text(patched, encoding="utf-8")
    print(f"  updated login success handler to preserve upstream post-login lifecycle in {path.name}")
    return True


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
