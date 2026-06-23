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
    return false;
  }
  if (isMandatoryAuthenticatorSetupComplete()) {
    return false;
  }
  if (!providerStatusKnown) {
    return false;
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

  const exemptPaths = [
    "/",
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

/** Auth/login routes that indicate logout is in progress — suspend the mandatory lock. */
export function isLogoutNavigationTarget(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  const logoutTargets = [
    "/",
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
      } else {
        mandatoryAuthenticatorRequired = true;
      }
    } catch {
      mandatoryAuthenticatorRequired = true;
    } finally {
      providerStatusKnown = true;
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
  await ensureMandatoryAuthenticatorStatus(twoFactorService);

  if (!isMandatoryLockModeActive()) {
    return true;
  }

  if (url && (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url))) {
    return true;
  }

  return createMandatorySetupUrlTree(router);
}

export function createMandatorySetupUrlTree(router: Router): UrlTree {
  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}
