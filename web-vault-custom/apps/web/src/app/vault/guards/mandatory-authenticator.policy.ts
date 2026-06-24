import { Router, UrlTree } from "@angular/router";

import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

/** Only whitelisted authenticated route while mandatory Authenticator 2FA is pending. */
export const MANDATORY_TWO_FACTOR_SETUP_URL = "/settings/security/two-factor";

let authenticatorSetupCompleteForSession = false;
let mandatoryAuthenticatorRequired = false;
let providerStatusKnown = false;
let statusCheckPromise: Promise<void> | null = null;
/** When true, mandatory lock is suspended (logout / unauthenticated transitions). */
let mandatoryLockSuspended = false;

const MANDATORY_2FA_LOG_PREFIX = "[Mandatory2FA]";

/** Trace guard decisions in the browser console (filter by Mandatory2FA). */
function logMandatoryDecision(message: string, detail?: Record<string, unknown>): void {
  if (typeof console !== "undefined" && console.debug) {
    console.debug(`${MANDATORY_2FA_LOG_PREFIX} ${message}`, detail ?? "");
  }
}

export function suspendMandatoryLock(): void {
  mandatoryLockSuspended = true;
}

export function resumeMandatoryLock(): void {
  mandatoryLockSuspended = false;
}

export function isMandatoryLockSuspended(): boolean {
  return mandatoryLockSuspended;
}

export function markMandatoryAuthenticatorSetupComplete(): void {
  authenticatorSetupCompleteForSession = true;
  mandatoryAuthenticatorRequired = false;
  providerStatusKnown = true;
}

export function resetMandatoryAuthenticatorSetupState(): void {
  authenticatorSetupCompleteForSession = false;
  mandatoryAuthenticatorRequired = false;
  providerStatusKnown = false;
  statusCheckPromise = null;
}

/** @deprecated Use resetMandatoryAuthenticatorSetupState */
export function clearMandatoryAuthenticatorGuardCache(): void {
  resetMandatoryAuthenticatorSetupState();
}

export function isMandatoryAuthenticatorSetupComplete(): boolean {
  return authenticatorSetupCompleteForSession;
}

export function isMandatoryAuthenticatorSetupRequired(): boolean {
  return mandatoryAuthenticatorRequired && !authenticatorSetupCompleteForSession;
}

/** Global lock mode: active only after we confirm Authenticator 2FA is missing. */
export function isMandatoryLockModeActive(): boolean {
  if (mandatoryLockSuspended) {
    logMandatoryDecision("lock mode inactive: suspended (logout in progress)");
    return false;
  }
  if (isMandatoryAuthenticatorSetupComplete()) {
    return false;
  }
  if (!providerStatusKnown) {
    return false;
  }
  if (mandatoryAuthenticatorRequired) {
    logMandatoryDecision("lock mode active: Authenticator 2FA not configured");
  }
  return mandatoryAuthenticatorRequired;
}

export function isMandatoryAuthenticatorStatusKnown(): boolean {
  return providerStatusKnown;
}

/** Normalize router URLs (hash routing, query strings, fragments). */
export function normalizeMandatorySetupPath(url: string): string {
  let path = (url ?? "").trim();

  const hashRouteIndex = path.indexOf("#/");
  if (hashRouteIndex >= 0) {
    path = path.substring(hashRouteIndex + 1);
  } else if (path.startsWith("#/")) {
    path = path.substring(1);
  }

  path = path.split("?")[0].split("#")[0].trim();

  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  return path.replace(/\/+$/, "") || "/";
}

/**
 * Whitelist while mandatory 2FA is missing:
 * - /settings/security/two-factor (2FA setup page + dialog)
 */
export function isMandatorySetupAllowedUrl(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  return (
    path === MANDATORY_TWO_FACTOR_SETUP_URL ||
    path.startsWith(`${MANDATORY_TWO_FACTOR_SETUP_URL}/`)
  );
}

/**
 * Routes that must never be blocked by mandatory 2FA lock (login/logout/auth flows).
 * Distinct from the authenticated 2FA setup whitelist.
 */
export function isMandatoryLockExemptNavigation(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  if (isMandatorySetupAllowedUrl(url)) {
    return true;
  }

  // Login-time two-factor (not Settings → Security → two-factor)
  if (path === "/two-factor" || (path.startsWith("/two-factor/") && !path.includes("/settings/"))) {
    return true;
  }

  // Note: "/" is intentionally omitted — it is the post-login default route for authenticated
  // users and must redirect to mandatory 2FA setup when enrollment is pending.
  const exemptPaths = [
    "/login",
    "/logout",
    "/signup",
    "/sign-up",
    "/finish-signup",
    "/verify-email",
    "/login-initiated",
    "/login-with-device",
    "/login-with-passkey",
    "/password-hint",
    "/set-initial-password",
    "/sso",
    "/lock",
    "/recover",
    "/recover-2fa",
    "/recover-delete",
    "/verify-recover-delete",
    "/verify-recover-delete-org",
    "/authentication-timeout",
    "/new-device-verification",
    "/admin-approval-requested",
    "/register",
  ];

  return exemptPaths.some((exempt) => path === exempt || path.startsWith(`${exempt}/`));
}

/**
 * Explicit unauthenticated auth routes used during logout navigation.
 * "/" is NOT included — authenticated users land on "/" after login and must stay in-session
 * for mandatory 2FA setup; treating "/" as logout incorrectly clears the mandatory lock.
 */
export function isLogoutNavigationTarget(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  const logoutTargets = [
    "/login",
    "/logout",
    "/signup",
    "/sign-up",
    "/finish-signup",
    "/login-initiated",
    "/login-with-device",
    "/login-with-passkey",
    "/register",
  ];

  return logoutTargets.some((target) => path === target || path.startsWith(`${target}/`));
}

/** Default-deny: block unless 2FA is complete or URL is explicitly whitelisted. */
export function shouldBlockMandatorySetupNavigation(url: string): boolean {
  if (!isMandatoryLockModeActive()) {
    return false;
  }

  if (isMandatoryLockExemptNavigation(url)) {
    return false;
  }

  return !isMandatorySetupAllowedUrl(url);
}

/**
 * Hide authenticated vault chrome while the mandatory 2FA API check is still in flight.
 * Prevents a brief vault flash for new accounts before redirect to setup.
 */
export function shouldHideVaultUntilMandatoryStatusResolved(url: string): boolean {
  if (mandatoryLockSuspended || isMandatoryAuthenticatorSetupComplete()) {
    return false;
  }

  if (providerStatusKnown) {
    return false;
  }

  if (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url)) {
    return false;
  }

  logMandatoryDecision("hide vault content until mandatory 2FA status is resolved", { url });
  return true;
}

async function refreshMandatoryAuthenticatorStatus(
  twoFactorService: TwoFactorService,
): Promise<void> {
  if (statusCheckPromise) {
    await statusCheckPromise;
    return;
  }

  statusCheckPromise = (async () => {
    try {
      const providerList = await twoFactorService.getEnabledTwoFactorProviders();
      const hasEnabledAuthenticator = providerList.data.some(
        (provider) =>
          provider.type === TwoFactorProviderType.Authenticator && provider.enabled === true,
      );

      if (hasEnabledAuthenticator) {
        authenticatorSetupCompleteForSession = true;
        mandatoryAuthenticatorRequired = false;
        logMandatoryDecision("status check: Authenticator 2FA configured — vault access allowed");
      } else {
        mandatoryAuthenticatorRequired = true;
        logMandatoryDecision("status check: no Authenticator 2FA — redirect to setup required");
      }
      providerStatusKnown = true;
    } catch {
      // Transient API errors must not permanently lock the session; retry on next navigation.
      mandatoryAuthenticatorRequired = true;
      providerStatusKnown = false;
      logMandatoryDecision("status check failed — will retry on next check");
    } finally {
      statusCheckPromise = null;
    }
  })();

  await statusCheckPromise;
}

export async function ensureMandatoryAuthenticatorStatus(
  twoFactorService: TwoFactorService,
): Promise<boolean> {
  if (authenticatorSetupCompleteForSession) {
    return true;
  }

  if (!providerStatusKnown) {
    await refreshMandatoryAuthenticatorStatus(twoFactorService);
  }

  return authenticatorSetupCompleteForSession;
}

export async function resolveMandatoryAuthenticatorAccess(
  router: Router,
  twoFactorService: TwoFactorService,
  url?: string,
): Promise<boolean | UrlTree> {
  // Priority 1: logout/disconnect in progress — never block sign-out navigation.
  if (isMandatoryLockSuspended()) {
    logMandatoryDecision("route guard: allow — mandatory lock suspended (logout)");
    return true;
  }

  if (url != null && isLogoutNavigationTarget(url)) {
    logMandatoryDecision("route guard: allow — logout/disconnect destination", { url });
    return true;
  }

  // Priority 3: authenticated Unlocked user — resolve mandatory 2FA enrollment.
  await ensureMandatoryAuthenticatorStatus(twoFactorService);

  if (!isMandatoryLockModeActive()) {
    logMandatoryDecision("route guard: allow — 2FA configured or not required", { url });
    return true;
  }

  if (url && (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url))) {
    logMandatoryDecision("route guard: allow — whitelisted or auth-exempt route", { url });
    return true;
  }

  logMandatoryDecision("route guard: redirect to mandatory 2FA setup", { url });
  return createMandatorySetupUrlTree(router);
}

export function createMandatorySetupUrlTree(router: Router): UrlTree {
  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}
