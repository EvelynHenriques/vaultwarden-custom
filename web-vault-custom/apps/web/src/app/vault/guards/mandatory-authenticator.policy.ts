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

/** Must match vaultwarden `mandatory_authenticator_2fa.rs` and auth guard log messages. */
export const MANDATORY_AUTHENTICATOR_SETUP_MESSAGE =
  "Authenticator app setup is required before continuing";

export const MANDATORY_AUTHENTICATOR_SETUP_LOG_MESSAGE =
  "User must configure Authenticator 2FA before using this endpoint";

export function extractApiErrorMessage(error: unknown): string | null {
  if (error == null) {
    return null;
  }

  if (typeof error === "string") {
    return error;
  }

  const candidate = error as {
    message?: string;
    Message?: string;
    error_description?: string;
    response?: { message?: string; Message?: string };
    error?: unknown;
    data?: unknown;
  };

  return (
    candidate.message ??
    candidate.Message ??
    candidate.error_description ??
    candidate.response?.message ??
    candidate.response?.Message ??
    extractApiErrorMessage(candidate.error) ??
    extractApiErrorMessage(candidate.data) ??
    null
  );
}

/** True only for the vaultwarden mandatory-2FA gate — not generic 403 responses. */
export function isMandatoryAuthenticatorSetupApiError(error: unknown): boolean {
  const message = extractApiErrorMessage(error);
  if (!message) {
    return false;
  }

  return (
    message.includes(MANDATORY_AUTHENTICATOR_SETUP_MESSAGE) ||
    message.includes(MANDATORY_AUTHENTICATOR_SETUP_LOG_MESSAGE) ||
    message.includes("Authenticator app setup is required") ||
    message.includes("User must configure Authenticator 2FA")
  );
}

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
  logMandatoryDecision("Authenticator 2FA configured — restriction lifted");
}

export function resetMandatoryAuthenticatorSetupState(): void {
  authenticatorSetupCompleteForSession = false;
  mandatoryAuthenticatorRequired = false;
  providerStatusKnown = false;
  statusCheckPromise = null;
}

/**
 * Enter restricted post-login state immediately on unlock, before any vault API calls.
 * Cleared when Authenticator 2FA is confirmed configured or the user logs out.
 */
export function enterPostLoginVerificationState(): void {
  if (mandatoryLockSuspended || isMandatoryAuthenticatorSetupComplete()) {
    return;
  }

  mandatoryAuthenticatorRequired = true;
  providerStatusKnown = false;
  logMandatoryDecision("post-login verification started — vault APIs blocked until 2FA status known");
}

/** Called when the server returns the mandatory-2FA gate message. */
export function confirmMandatoryAuthenticatorRequiredFromApi(): void {
  if (mandatoryLockSuspended || isMandatoryAuthenticatorSetupComplete()) {
    return;
  }

  mandatoryAuthenticatorRequired = true;
  providerStatusKnown = true;
  logMandatoryDecision("server reports Authenticator 2FA required");
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

/** Active while Authenticator 2FA is missing or still being verified after unlock. */
export function isMandatoryLockModeActive(): boolean {
  if (mandatoryLockSuspended || isMandatoryAuthenticatorSetupComplete()) {
    return false;
  }

  return mandatoryAuthenticatorRequired || !providerStatusKnown;
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

/** Whitelist while mandatory 2FA is missing. */
export function isMandatorySetupAllowedUrl(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  return (
    path === MANDATORY_TWO_FACTOR_SETUP_URL ||
    path.startsWith(`${MANDATORY_TWO_FACTOR_SETUP_URL}/`)
  );
}

/** Routes that must never be blocked (login/logout/auth flows). */
export function isMandatoryLockExemptNavigation(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  if (isMandatorySetupAllowedUrl(url)) {
    return true;
  }

  if (path === "/two-factor" || (path.startsWith("/two-factor/") && !path.includes("/settings/"))) {
    return true;
  }

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

/** Logout/disconnect destinations — never block sign-out navigation. */
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

/** Hide vault chrome while the mandatory 2FA status check is still in flight. */
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
        logMandatoryDecision("status check: Authenticator 2FA configured");
      } else {
        mandatoryAuthenticatorRequired = true;
        logMandatoryDecision("status check: Authenticator 2FA not configured");
      }
      providerStatusKnown = true;
    } catch (error) {
      if (isMandatoryAuthenticatorSetupApiError(error)) {
        confirmMandatoryAuthenticatorRequiredFromApi();
      } else {
        logMandatoryDecision("status check failed — not assuming missing 2FA", {
          error: extractApiErrorMessage(error),
        });
      }
    } finally {
      statusCheckPromise = null;
    }
  })();

  await statusCheckPromise;
}

/**
 * Single entry point for the mandatory-2FA provider check.
 * Deduplicates concurrent calls and leaves session state in a known shape.
 */
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

/** Authenticated routes blocked until mandatory Authenticator 2FA is configured. */
export function isMandatoryPostLoginRouteBlocked(url: string): boolean {
  if (isMandatoryLockSuspended() || isMandatoryAuthenticatorSetupComplete()) {
    return false;
  }

  if (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url)) {
    return false;
  }

  return isMandatoryLockModeActive();
}

/**
 * Route-guard decision: allow navigation, or return a UrlTree to the setup page.
 * This is the single routing enforcement entry point.
 */
export async function resolveMandatoryAuthenticatorAccess(
  router: Router,
  twoFactorService: TwoFactorService,
  url?: string,
): Promise<boolean | UrlTree> {
  if (isMandatoryLockSuspended()) {
    return true;
  }

  if (url != null && isLogoutNavigationTarget(url)) {
    return true;
  }

  if (url != null && isMandatoryLockExemptNavigation(url)) {
    return true;
  }

  await ensureMandatoryAuthenticatorStatus(twoFactorService);

  if (isMandatoryAuthenticatorSetupComplete()) {
    return true;
  }

  if (url && isMandatorySetupAllowedUrl(url)) {
    return true;
  }

  logMandatoryDecision("route blocked — redirect to mandatory 2FA setup", { url });
  return createMandatorySetupUrlTree(router);
}

export function createMandatorySetupUrlTree(router: Router): UrlTree {
  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}

/** Used by setup-extension guards after the shared status check. */
export async function getMandatoryAuthenticatorRedirect(
  router: Router,
  twoFactorService: TwoFactorService,
): Promise<UrlTree | null> {
  if (isMandatoryLockSuspended() || isMandatoryAuthenticatorSetupComplete()) {
    return null;
  }

  await ensureMandatoryAuthenticatorStatus(twoFactorService);

  if (isMandatoryAuthenticatorSetupComplete()) {
    return null;
  }

  return createMandatorySetupUrlTree(router);
}

export function shouldHideAuthenticatedContent(url: string): boolean {
  if (isMandatoryLockSuspended()) {
    return false;
  }

  if (shouldHideVaultUntilMandatoryStatusResolved(url)) {
    return true;
  }

  if (!isMandatoryLockModeActive()) {
    return false;
  }

  return isMandatoryPostLoginRouteBlocked(url);
}

/** API paths allowed while mandatory Authenticator 2FA setup is pending (2FA enrollment only). */
export function isMandatoryVaultApiAllowedPath(path: string): boolean {
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  const allowedExact = ["/identity/connect/token", "/config", "/configs"];
  if (allowedExact.includes(normalized)) {
    return true;
  }

  if (normalized.startsWith("/identity/connect/")) {
    return true;
  }

  const allowedPrefixes = [
    "/two-factor",
    "/accounts/verify-password",
    "/accounts/request-otp",
    "/accounts/verify-otp",
    "/accounts/set-password",
    "/accounts/keys",
  ];

  return allowedPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/** Block authenticated vault API calls while mandatory 2FA is not yet configured. */
export function shouldBlockMandatoryVaultApiRequest(request: Request): boolean {
  if (isMandatoryLockSuspended() || isMandatoryAuthenticatorSetupComplete()) {
    return false;
  }

  if (!isMandatoryLockModeActive()) {
    return false;
  }

  if (!request.headers.get("Authorization")) {
    return false;
  }

  try {
    const pathname = new URL(request.url, "https://localhost").pathname;
    const apiPath = pathname.startsWith("/api/") ? pathname.substring(4) : pathname;
    if (isMandatoryVaultApiAllowedPath(apiPath)) {
      return false;
    }
  } catch {
    return false;
  }

  logMandatoryDecision("blocked vault API until Authenticator 2FA configured", {
    url: request.url,
  });
  return true;
}
