import { Router, UrlTree } from "@angular/router";

import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

/** Only whitelisted authenticated route while mandatory Authenticator 2FA is pending. */
export const MANDATORY_TWO_FACTOR_SETUP_URL = "/settings/security/two-factor";

const LOG = "[Mandatory2FA]";

/** Set to `false` to disable temporary mandatory-2FA debug logs after validation. */
export let MANDATORY_2FA_DEBUG_ENABLED = true;

export function setMandatory2faDebugEnabled(enabled: boolean): void {
  MANDATORY_2FA_DEBUG_ENABLED = enabled;
}

export function mandatory2faLog(message: string, detail?: unknown): void {
  if (!MANDATORY_2FA_DEBUG_ENABLED || typeof console === "undefined" || !console.debug) {
    return;
  }
  console.debug(`${LOG} ${message}`, detail ?? "");
}

/** Operational warnings (sync failures, etc.) — visible without DevTools Verbose. */
export function mandatory2faWarn(message: string, detail?: unknown): void {
  if (typeof console === "undefined" || !console.warn) {
    return;
  }
  console.warn(`${LOG} ${message}`, detail ?? "");
}

/** Gate phases — single source of truth for mandatory 2FA session state. */
export type MandatoryGatePhase = "idle" | "pending" | "blocked" | "released";

let gatePhase: MandatoryGatePhase = "idle";
let statusCheckPromise: Promise<MandatoryGatePhase> | null = null;
let mandatoryLockSuspended = false;

export const MANDATORY_AUTHENTICATOR_SETUP_MESSAGE =
  "Authenticator app setup is required before continuing";

export const MANDATORY_AUTHENTICATOR_SETUP_LOG_MESSAGE =
  "User must configure Authenticator 2FA before using this endpoint";

function log(message: string, detail?: unknown): void {
  mandatory2faLog(message, detail);
}

export function getMandatoryGatePhase(): MandatoryGatePhase {
  return gatePhase;
}

export function suspendMandatoryLock(): void {
  mandatoryLockSuspended = true;
  log("logout/disconnect from restricted state");
}

export function resumeMandatoryLock(): void {
  mandatoryLockSuspended = false;
}

export function isMandatoryLockSuspended(): boolean {
  return mandatoryLockSuspended;
}

export function resetMandatoryAuthenticatorSetupState(): void {
  gatePhase = "idle";
  statusCheckPromise = null;
  log("gate state = idle (session reset)");
}

export function markMandatoryAuthenticatorSetupComplete(): void {
  gatePhase = "released";
  statusCheckPromise = null;
  log("releasing gate after 2FA configured");
}

/** @deprecated Use resetMandatoryAuthenticatorSetupState */
export function clearMandatoryAuthenticatorGuardCache(): void {
  resetMandatoryAuthenticatorSetupState();
}

export function isMandatoryAuthenticatorSetupComplete(): boolean {
  return gatePhase === "released";
}

export function isMandatoryAuthenticatorSetupRequired(): boolean {
  return gatePhase === "blocked";
}

export function isMandatoryLockModeActive(): boolean {
  if (mandatoryLockSuspended || gatePhase === "released" || gatePhase === "idle") {
    return false;
  }
  return gatePhase === "pending" || gatePhase === "blocked";
}

export function isMandatoryAuthenticatorStatusKnown(): boolean {
  return gatePhase === "blocked" || gatePhase === "released";
}

/** Begin post-login verification — only transitions from idle. */
export function enterPostLoginVerificationState(): void {
  if (mandatoryLockSuspended || gatePhase === "released") {
    return;
  }
  if (gatePhase === "idle") {
    gatePhase = "pending";
    log("enter post-login verification state");
    log("gate state = pending");
  }
}

export function confirmMandatoryAuthenticatorRequiredFromApi(): void {
  if (mandatoryLockSuspended || gatePhase === "released") {
    return;
  }
  gatePhase = "blocked";
  log("decision = missing authenticator (from API)");
  log("gate state = blocked");
}

/**
 * Fail-safe when verification cannot complete: block vault access, never release.
 * Only transitions from `pending` — never downgrades `released`.
 */
export function failSafeUnresolvedGate(): void {
  if (mandatoryLockSuspended || gatePhase === "released" || gatePhase === "blocked") {
    return;
  }

  gatePhase = "blocked";
  log("decision = unknown (fail-safe block — vault access denied)");
  log("gate state = blocked");
}

export function isVaultAccessAllowedByGate(): boolean {
  return gatePhase === "released";
}

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
    errorModel?: { message?: string };
    validationErrors?: Record<string, string[]>;
  };
  const direct =
    candidate.message ??
    candidate.Message ??
    candidate.error_description ??
    candidate.response?.message ??
    candidate.response?.Message ??
    candidate.errorModel?.message ??
    null;
  if (direct) {
    return direct;
  }
  const validationMessages = candidate.validationErrors?.[""];
  if (Array.isArray(validationMessages) && validationMessages.length > 0) {
    return validationMessages.join(" ");
  }
  return (
    extractApiErrorMessage(candidate.error) ??
    extractApiErrorMessage(candidate.data) ??
    null
  );
}

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

/** Broadcaster / API payloads may nest the mandatory setup error. */
export function isMandatoryAuthenticatorAuthFailureSignal(
  signal?: Record<string, unknown>,
): boolean {
  if (signal == null) {
    return false;
  }
  if (isMandatoryAuthenticatorSetupApiError(signal)) {
    return true;
  }
  for (const key of ["error", "response", "data", "body"] as const) {
    if (isMandatoryAuthenticatorSetupApiError(signal[key])) {
      return true;
    }
  }
  return false;
}

/**
 * True while post-login verification or mandatory setup is in progress.
 * Vault access remains denied until gatePhase becomes `released`.
 */
export function isMandatoryGateRestricted(): boolean {
  return gatePhase === "pending" || gatePhase === "blocked";
}

/**
 * Whether authBlocked/locked/logout(invalidAccessToken) should be handled as
 * mandatory Authenticator setup instead of invalid session.
 *
 * Scope (intentionally narrow):
 * - `released` + no mandatory payload → never intercept (normal auth failures apply)
 * - explicit mandatory 2FA message in payload → intercept
 * - missing mandatory payload → never intercept, even while pending/blocked
 */
export function shouldInterceptAuthFailureAsMandatorySetup(
  phase: MandatoryGatePhase,
  signal?: Record<string, unknown>,
): boolean {
  void phase;
  const hasMandatoryPayload = isMandatoryAuthenticatorAuthFailureSignal(signal);

  return hasMandatoryPayload;
}

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

export function isMandatorySetupAllowedUrl(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);
  return (
    path === MANDATORY_TWO_FACTOR_SETUP_URL ||
    path.startsWith(`${MANDATORY_TWO_FACTOR_SETUP_URL}/`)
  );
}

export function isMandatoryLockExemptNavigation(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);
  if (isMandatorySetupAllowedUrl(url)) {
    return true;
  }
  if (path === "/2fa" || path.startsWith("/2fa/")) {
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

export function isMandatoryVaultApiAllowedPath(path: string): boolean {
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  // Never block Identity Server requests (login, token exchange, SSO, etc.).
  if (normalized.startsWith("/identity/")) {
    return true;
  }

  if (
    normalized === "/identity/connect/token" ||
    normalized === "/config" ||
    normalized === "/configs"
  ) {
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
    "/accounts/profile",
    "/accounts/revision-date",
  ];

  return allowedPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/** True for login-time routes reached before AuthenticationStatus.Unlocked. */
export function isPreLoginAuthenticationRoute(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);
  return (
    path === "/2fa" ||
    path.startsWith("/2fa/") ||
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/lock" ||
    path.startsWith("/lock/")
  );
}

/** Identity Server requests must never be touched by mandatory vault API middleware. */
export function isIdentityServerRequest(request: Request): boolean {
  try {
    const pathname = new URL(request.url, "https://localhost").pathname;
    return pathname.includes("/identity/");
  } catch {
    return false;
  }
}

export function shouldBlockMandatoryVaultApiRequest(request: Request): boolean {
  if (isIdentityServerRequest(request)) {
    return false;
  }

  // Block sensitive vault APIs while the gate is unresolved or confirmed blocked.
  // Setup/bootstrap endpoints remain available so Authenticator enrollment can complete.
  if (isMandatoryLockSuspended() || (gatePhase !== "pending" && gatePhase !== "blocked")) {
    return false;
  }

  if (!request.headers.get("Authorization")) {
    return false;
  }

  try {
    const pathname = new URL(request.url, "https://localhost").pathname;
    const apiPath = pathname.startsWith("/api/") ? pathname.substring(4) : pathname;
    if (isMandatoryVaultApiAllowedPath(apiPath)) {
      if (apiPath !== "/config" && apiPath !== "/configs") {
        log(`API allowed: ${apiPath}`);
      }
      return false;
    }
    if (apiPath === "/sync" || apiPath.startsWith("/sync")) {
      log(`/api/sync attempted while mandatory gate is ${gatePhase} — blocked locally`);
    }
    log(`API blocked locally: ${apiPath}`);
    return true;
  } catch {
    return false;
  }
}

async function fetchMandatoryAuthenticatorStatus(
  twoFactorService: TwoFactorService,
): Promise<MandatoryGatePhase> {
  log("calling /api/two-factor");
  try {
    const providerList = await twoFactorService.getEnabledTwoFactorProviders();
    const hasEnabledAuthenticator = providerList.data.some(
      (provider) =>
        provider.type === TwoFactorProviderType.Authenticator && provider.enabled === true,
    );

    log("/api/two-factor result = success", {
      providers: providerList.data.map((p) => ({ type: p.type, enabled: p.enabled })),
      hasEnabledAuthenticator,
    });

    if (gatePhase === "released") {
      return "released";
    }

    if (hasEnabledAuthenticator) {
      log("decision = authenticator configured");
      gatePhase = "released";
      log("gate state = released");
      return "released";
    }

    log("decision = missing authenticator");
    gatePhase = "blocked";
    log("gate state = blocked");
    return "blocked";
  } catch (error) {
    log("error while resolving state =", extractApiErrorMessage(error));
    if (isMandatoryAuthenticatorSetupApiError(error)) {
      confirmMandatoryAuthenticatorRequiredFromApi();
      return "blocked";
    }
    failSafeUnresolvedGate();
    return "blocked";
  }
}

/**
 * Resolve mandatory 2FA status once per pending session.
 * Returns the gate phase after resolution.
 */
export async function resolveMandatoryAuthenticatorGate(
  twoFactorService: TwoFactorService,
): Promise<MandatoryGatePhase> {
  if (gatePhase === "released") {
    return "released";
  }

  if (mandatoryLockSuspended) {
    return gatePhase;
  }

  enterPostLoginVerificationState();

  if (gatePhase === "blocked") {
    return "blocked";
  }

  if (statusCheckPromise) {
    return statusCheckPromise;
  }

  statusCheckPromise = fetchMandatoryAuthenticatorStatus(twoFactorService).finally(() => {
    statusCheckPromise = null;
  });

  return statusCheckPromise;
}

/** @deprecated Use resolveMandatoryAuthenticatorGate */
export async function ensureMandatoryAuthenticatorStatus(
  twoFactorService: TwoFactorService,
): Promise<boolean> {
  const phase = await resolveMandatoryAuthenticatorGate(twoFactorService);
  return phase === "released";
}

export function isMandatoryPostLoginRouteBlocked(url: string): boolean {
  if (isMandatoryLockSuspended() || gatePhase === "released" || gatePhase === "idle") {
    return false;
  }
  if (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url)) {
    return false;
  }
  return gatePhase === "pending" || gatePhase === "blocked";
}

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

  const phase = await resolveMandatoryAuthenticatorGate(twoFactorService);

  if (phase === "released") {
    return true;
  }

  if (url && isMandatorySetupAllowedUrl(url)) {
    return true;
  }

  if (phase === "pending") {
    failSafeUnresolvedGate();
  }

  log("route blocked — redirect to mandatory 2FA setup", { url });
  return createMandatorySetupUrlTree(router);
}

export function createMandatorySetupUrlTree(router: Router): UrlTree {
  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}

export async function getMandatoryAuthenticatorRedirect(
  router: Router,
  twoFactorService: TwoFactorService,
): Promise<UrlTree | null> {
  if (isMandatoryLockSuspended() || gatePhase === "released") {
    return null;
  }

  const phase = await resolveMandatoryAuthenticatorGate(twoFactorService);

  if (phase === "released") {
    return null;
  }

  return createMandatorySetupUrlTree(router);
}

export function shouldHideAuthenticatedContent(url: string): boolean {
  if (isMandatoryLockSuspended()) {
    return false;
  }

  if (gatePhase === "released" || gatePhase === "idle") {
    return false;
  }

  if (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url)) {
    return false;
  }

  return gatePhase === "pending" || gatePhase === "blocked";
}
