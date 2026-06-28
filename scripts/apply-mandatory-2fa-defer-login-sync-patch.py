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
REGEN_BLOCK = """    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] before key regeneration");
    try {
      await this.userAsymmetricKeysRegenerationService.regenerateIfNeeded(userId);
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] after key regeneration");
    } catch (error: unknown) {
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] key regeneration failed", error);
      throw error;
    }"""

PATCHED_PREFIX = f"""{RUN_SIGNATURE}
    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] DefaultLoginSuccessHandlerService.run started");
    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] auth state stable");
    // {MARKER}: keep upstream sync for real TOTP logins, but avoid /api/sync before setup.
    const ebvaultCurrentFlowPassedTotp =
      (globalThis as {{ EBVAULT_CURRENT_AUTH_FLOW_PASSED_TOTP?: boolean }})
        .EBVAULT_CURRENT_AUTH_FLOW_PASSED_TOTP === true;
    if (ebvaultCurrentFlowPassedTotp) {{
      await this.syncService.fullSync(true, {{ skipTokenRefresh: true }});
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] upstream login-time fullSync completed after TOTP");
    }} else {{
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault 2FA] sync deferred without throwing during login bootstrap");
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory no-TOTP gate check starting before default navigation");
      const ebvaultMandatoryGatePromise =
        (globalThis as {{ EBVAULT_MANDATORY_2FA_GATE_PROMISE?: Promise<{{ kind?: string }}> }})
          .EBVAULT_MANDATORY_2FA_GATE_PROMISE;
      const ebvaultMandatoryGateDecision =
        ebvaultMandatoryGatePromise != null
          ? await ebvaultMandatoryGatePromise
          : (globalThis as {{ EBVAULT_MANDATORY_2FA_GATE_DECISION?: {{ kind?: string }} }})
              .EBVAULT_MANDATORY_2FA_GATE_DECISION;
      if (ebvaultMandatoryGateDecision?.kind === "setup_required") {{
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory gate result: setup required");
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] default /vault navigation skipped because mandatory setup is required");
        (globalThis as {{ EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT?: string }})
          .EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT = "/settings/security/two-factor";
      }} else {{
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory gate result: " + (ebvaultMandatoryGateDecision?.kind ?? "unknown"));
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] continuing original Web Vault login flow");
      }}
    }}
    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] original post-login bootstrap completed");
{REGEN_BLOCK}"""

COMPLETION_LOG = '    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] DefaultLoginSuccessHandlerService.run completed");'
LOGIN_COMPONENT = "libs/auth/src/angular/login/login.component.ts"
DEEP_LINK_GUARD = "apps/web/src/app/auth/guards/deep-link/deep-link.guard.ts"
AUTH_GUARD = "libs/angular/src/auth/guards/auth.guard.ts"
LOGIN_REDIRECT_MARKER = "EBvault mandatory setup redirect after no-TOTP gate"
DEEP_LINK_MARKER = "EBvault mandatory setup suppresses deep-link vault restore"
AUTH_GUARD_MARKER = "EBvault mandatory setup bypasses authGuard force-state checks"

LOGIN_HANDLER_CALL = (
    "    await this.loginSuccessHandlerService.run(authResult.userId, authResult.masterPassword);"
)

LOGIN_REDIRECT_BLOCK = f"""{LOGIN_HANDLER_CALL}

    // {LOGIN_REDIRECT_MARKER}: no-TOTP users must not continue to the default vault route.
    const ebvaultMandatoryLoginRedirect =
      (globalThis as {{ EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT?: string }})
        .EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT;
    if (ebvaultMandatoryLoginRedirect) {{
      delete (globalThis as {{ EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT?: string }})
        .EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT;
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] navigating to mandatory setup instead of default vault route", {{
        target: ebvaultMandatoryLoginRedirect,
      }});
      await new Promise((resolve) => setTimeout(resolve, 0));
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] deferred mandatory setup navigation starting", {{
        currentUrl: this.router.url,
        target: ebvaultMandatoryLoginRedirect,
      }});
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault SETUP ROUTE] setup navigation promise created", {{
        currentUrl: this.router.url,
        target: ebvaultMandatoryLoginRedirect,
      }});
      let ebvaultMandatorySetupNavigationSettled = false;
      const ebvaultMandatorySetupNavigationPendingTimer = setTimeout(() => {{
        if (ebvaultMandatorySetupNavigationSettled) {{
          return;
        }}
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault SETUP ROUTE] setup navigation still pending after 2s", {{
          currentUrl: this.router.url,
          routerStateUrl: this.router.routerState?.snapshot?.url,
          target: ebvaultMandatoryLoginRedirect,
        }});
      }}, 2000);
      try {{
        const ebvaultMandatorySetupNavigationResult = await this.router.navigateByUrl(
          ebvaultMandatoryLoginRedirect,
          {{ replaceUrl: true }},
        );
        ebvaultMandatorySetupNavigationSettled = true;
        clearTimeout(ebvaultMandatorySetupNavigationPendingTimer);
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log(
          ebvaultMandatorySetupNavigationResult
            ? "[EBvault SETUP ROUTE] setup navigation promise resolved true"
            : "[EBvault SETUP ROUTE] setup navigation promise resolved false",
          {{
            currentUrl: this.router.url,
            routerStateUrl: this.router.routerState?.snapshot?.url,
            target: ebvaultMandatoryLoginRedirect,
          }},
        );
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory setup navigation completed", {{
          result: ebvaultMandatorySetupNavigationResult,
          currentUrl: this.router.url,
        }});
      }} catch (error: unknown) {{
        ebvaultMandatorySetupNavigationSettled = true;
        clearTimeout(ebvaultMandatorySetupNavigationPendingTimer);
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault SETUP ROUTE] setup navigation promise rejected", error);
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory setup navigation failed", error);
        throw error;
      }}
      return;
    }}"""

OLD_LOGIN_REDIRECT_NAVIGATION = (
    "      await this.router.navigateByUrl(ebvaultMandatoryLoginRedirect, { replaceUrl: true });"
)

DEFERRED_LOGIN_REDIRECT_NAVIGATION = """      await new Promise((resolve) => setTimeout(resolve, 0));
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] deferred mandatory setup navigation starting", {
        currentUrl: this.router.url,
        target: ebvaultMandatoryLoginRedirect,
      });
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault SETUP ROUTE] setup navigation promise created", {
        currentUrl: this.router.url,
        target: ebvaultMandatoryLoginRedirect,
      });
      let ebvaultMandatorySetupNavigationSettled = false;
      const ebvaultMandatorySetupNavigationPendingTimer = setTimeout(() => {
        if (ebvaultMandatorySetupNavigationSettled) {
          return;
        }
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault SETUP ROUTE] setup navigation still pending after 2s", {
          currentUrl: this.router.url,
          routerStateUrl: this.router.routerState?.snapshot?.url,
          target: ebvaultMandatoryLoginRedirect,
        });
      }, 2000);
      try {
        const ebvaultMandatorySetupNavigationResult = await this.router.navigateByUrl(
          ebvaultMandatoryLoginRedirect,
          { replaceUrl: true },
        );
        ebvaultMandatorySetupNavigationSettled = true;
        clearTimeout(ebvaultMandatorySetupNavigationPendingTimer);
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log(
          ebvaultMandatorySetupNavigationResult
            ? "[EBvault SETUP ROUTE] setup navigation promise resolved true"
            : "[EBvault SETUP ROUTE] setup navigation promise resolved false",
          {
            currentUrl: this.router.url,
            routerStateUrl: this.router.routerState?.snapshot?.url,
            target: ebvaultMandatoryLoginRedirect,
          },
        );
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory setup navigation completed", {
          result: ebvaultMandatorySetupNavigationResult,
          currentUrl: this.router.url,
        });
      } catch (error: unknown) {
        ebvaultMandatorySetupNavigationSettled = true;
        clearTimeout(ebvaultMandatorySetupNavigationPendingTimer);
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault SETUP ROUTE] setup navigation promise rejected", error);
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory setup navigation failed", error);
        throw error;
      }"""

DEEP_LINK_AUTH_UNLOCKED_ANCHOR = "    if (authStatus === AuthenticationStatus.Unlocked) {\n"
DEEP_LINK_SUPPRESS_BLOCK = f"""{DEEP_LINK_AUTH_UNLOCKED_ANCHOR}      // {DEEP_LINK_MARKER}: no-TOTP users must not replay a saved /vault destination.
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault DEEP LINK] start", {{ requestedUrl: routerState.url }});
      const ebvaultMandatoryGateDecision =
        (globalThis as {{ EBVAULT_MANDATORY_2FA_GATE_DECISION?: {{ kind?: string }} }})
          .EBVAULT_MANDATORY_2FA_GATE_DECISION;
      const ebvaultMandatoryLoginRedirect =
        (globalThis as {{ EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT?: string }})
          .EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT;
      const ebvaultMandatorySetupRequired =
        ebvaultMandatoryGateDecision?.kind === "setup_required" ||
        ebvaultMandatoryLoginRedirect === "/settings/security/two-factor";
      if (ebvaultMandatorySetupRequired) {{
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault DEEP LINK] mandatory setup route detected", {{
          requestedUrl: routerState.url,
          gateDecision: ebvaultMandatoryGateDecision?.kind,
        }});
        const ebvaultDiscardedPreLoginUrl = await routerService.getAndClearLoginRedirectUrl();
        const ebvaultRequestedPath = routerState.url.split("?")[0].split("#")[0];
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault DEEP LINK] stale redirect value", ebvaultDiscardedPreLoginUrl);
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault DEEP LINK] clearing stale persisted redirect");
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault DEBUG] /vault navigation source suppressed: deepLinkGuard persisted login redirect", {{
          requestedUrl: routerState.url,
          discardedUrl: ebvaultDiscardedPreLoginUrl,
        }});
        if (
          ebvaultRequestedPath === "/settings/security/two-factor" ||
          ebvaultRequestedPath.startsWith("/settings/security/two-factor/")
        ) {{
          (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault 2FA SETUP] setup route allowed after suppressing stale protected destination");
          (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault DEEP LINK] returning true immediately for mandatory setup");
          return true;
        }}
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault 2FA SETUP] deep-link protected destination redirected back to setup", {{
          requestedUrl: routerState.url,
          target: "/settings/security/two-factor",
        }});
        return router.createUrlTree(["/settings/security/two-factor"]);
      }}
      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault DEEP LINK] falling through to upstream behavior", {{
        requestedUrl: routerState.url,
      }});
"""

AUTH_GUARD_STATUS_ANCHOR = "  const authStatus = await authService.getAuthStatus();\n\n"
AUTH_GUARD_SETUP_BYPASS_BLOCK = f"""  const authStatus = await authService.getAuthStatus();
  (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault AUTH GUARD] start", {{
    requestedUrl: routerState.url,
    authStatus,
  }});

  // {AUTH_GUARD_MARKER}: the restricted setup route must not wait on normal vault shell state.
  const ebvaultRequestedPath = routerState.url.split("?")[0].split("#")[0];
  const ebvaultMandatoryGateDecision =
    (globalThis as {{ EBVAULT_MANDATORY_2FA_GATE_DECISION?: {{ kind?: string }} }})
      .EBVAULT_MANDATORY_2FA_GATE_DECISION;
  const ebvaultMandatoryLoginRedirect =
    (globalThis as {{ EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT?: string }})
      .EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT;
  const ebvaultMandatorySetupRequired =
    ebvaultMandatoryGateDecision?.kind === "setup_required" ||
    ebvaultMandatoryLoginRedirect === "/settings/security/two-factor";
  const ebvaultMandatorySetupRoute =
    ebvaultRequestedPath === "/settings/security/two-factor" ||
    ebvaultRequestedPath.startsWith("/settings/security/two-factor/");
  if (
    authStatus !== AuthenticationStatus.LoggedOut &&
    ebvaultMandatorySetupRequired &&
    ebvaultMandatorySetupRoute
  ) {{
    (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault AUTH GUARD] mandatory setup route allowed immediately", {{
      requestedUrl: routerState.url,
      gateDecision: ebvaultMandatoryGateDecision?.kind,
    }});
    return true;
  }}

"""


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
        run_method = ensure_completion_log(
            upgrade_gate_wait(replace_patched_prefix(upgrade_regeneration_logging(text[start:end])))
        )
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
        patched_method = ensure_completion_log(upgrade_gate_wait(replace_patched_prefix(run_method)))
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


def upgrade_gate_wait(run_method: str) -> str:
    if "EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT" in run_method:
        return run_method

    anchor = '      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault 2FA] sync deferred without throwing during login bootstrap");'
    if anchor not in run_method:
        return run_method

    gate_wait = """      (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory no-TOTP gate check starting before default navigation");
      const ebvaultMandatoryGatePromise =
        (globalThis as { EBVAULT_MANDATORY_2FA_GATE_PROMISE?: Promise<{ kind?: string }> })
          .EBVAULT_MANDATORY_2FA_GATE_PROMISE;
      const ebvaultMandatoryGateDecision =
        ebvaultMandatoryGatePromise != null
          ? await ebvaultMandatoryGatePromise
          : (globalThis as { EBVAULT_MANDATORY_2FA_GATE_DECISION?: { kind?: string } })
              .EBVAULT_MANDATORY_2FA_GATE_DECISION;
      if (ebvaultMandatoryGateDecision?.kind === "setup_required") {
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory gate result: setup required");
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] default /vault navigation skipped because mandatory setup is required");
        (globalThis as { EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT?: string })
          .EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT = "/settings/security/two-factor";
      } else {
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] mandatory gate result: " + (ebvaultMandatoryGateDecision?.kind ?? "unknown"));
        (globalThis as any).EBVAULT_2FA_DEBUG === true && console.log("[EBvault LOGIN] continuing original Web Vault login flow");
      }"""
    return run_method.replace(anchor, f"{anchor}\n{gate_wait}", 1)


def replace_patched_prefix(run_method: str) -> str:
    if MARKER not in run_method:
        return run_method
    if "EBVAULT_MANDATORY_2FA_LOGIN_REDIRECT" in run_method:
        return run_method

    regen_index = run_method.find(REGEN_BLOCK)
    if regen_index == -1:
        return run_method

    prefix_end = regen_index + len(REGEN_BLOCK)
    return PATCHED_PREFIX + run_method[prefix_end:]


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


def apply_login_component_redirect_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if LOGIN_REDIRECT_MARKER in text:
        if "deferred mandatory setup navigation starting" not in text:
            if OLD_LOGIN_REDIRECT_NAVIGATION not in text:
                raise RuntimeError(
                    f"{path}: mandatory setup redirect marker exists but navigation anchor was not found"
                )
            patched = text.replace(OLD_LOGIN_REDIRECT_NAVIGATION, DEFERRED_LOGIN_REDIRECT_NAVIGATION, 1)
            path.write_text(patched, encoding="utf-8")
            print(f"  upgraded mandatory setup login redirect timing in {path.name}")
            return True
        print(f"  mandatory setup login redirect already applied in {path.name}")
        return False

    if LOGIN_HANDLER_CALL not in text:
        raise RuntimeError(
            f"{path}: could not find password login success handler call — "
            "Bitwarden clients version may have changed"
        )

    patched = text.replace(LOGIN_HANDLER_CALL, LOGIN_REDIRECT_BLOCK, 1)
    path.write_text(patched, encoding="utf-8")
    print(f"  added mandatory setup redirect before default vault navigation in {path.name}")
    return True


def apply_deep_link_guard_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if DEEP_LINK_MARKER in text:
        print(f"  mandatory setup deep-link suppression already applied in {path.name}")
        return False

    if DEEP_LINK_AUTH_UNLOCKED_ANCHOR not in text:
        raise RuntimeError(
            f"{path}: could not find deepLinkGuard unlocked branch — "
            "Bitwarden clients version may have changed"
        )

    patched = text.replace(DEEP_LINK_AUTH_UNLOCKED_ANCHOR, DEEP_LINK_SUPPRESS_BLOCK, 1)
    path.write_text(patched, encoding="utf-8")
    print(f"  added mandatory setup deep-link suppression in {path.name}")
    return True


def apply_auth_guard_patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if AUTH_GUARD_MARKER in text:
        print(f"  mandatory setup auth guard fast path already applied in {path.name}")
        return False

    if AUTH_GUARD_STATUS_ANCHOR not in text:
        raise RuntimeError(
            f"{path}: could not find authGuard auth status anchor — "
            "Bitwarden clients version may have changed"
        )

    patched = text.replace(AUTH_GUARD_STATUS_ANCHOR, AUTH_GUARD_SETUP_BYPASS_BLOCK, 1)
    path.write_text(patched, encoding="utf-8")
    print(f"  added mandatory setup auth guard fast path in {path.name}")
    return True


def main() -> int:
    clients_dir = Path(sys.argv[1])
    handler_path = (
        clients_dir
        / "libs/auth/src/common/services/login-success-handler/default-login-success-handler.service.ts"
    )
    if not handler_path.is_file():
        raise SystemExit(f"ERROR: missing {handler_path}")
    login_component_path = clients_dir / LOGIN_COMPONENT
    if not login_component_path.is_file():
        raise SystemExit(f"ERROR: missing {login_component_path}")
    deep_link_guard_path = clients_dir / DEEP_LINK_GUARD
    if not deep_link_guard_path.is_file():
        raise SystemExit(f"ERROR: missing {deep_link_guard_path}")
    auth_guard_path = clients_dir / AUTH_GUARD
    if not auth_guard_path.is_file():
        raise SystemExit(f"ERROR: missing {auth_guard_path}")
    apply_defer_login_sync_patch(handler_path)
    apply_login_component_redirect_patch(login_component_path)
    apply_deep_link_guard_patch(deep_link_guard_path)
    apply_auth_guard_patch(auth_guard_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
