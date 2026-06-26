import { Router, UrlTree } from "@angular/router";

import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

/** Only whitelisted authenticated route while mandatory Authenticator 2FA is pending. */
export const MANDATORY_TWO_FACTOR_SETUP_URL = "/settings/security/two-factor";

const LOG = "[EBvault 2FA]";

/** Set to `false` to disable temporary mandatory-2FA debug logs after validation. */
export let MANDATORY_2FA_DEBUG_ENABLED = true;

export function setMandatory2faDebugEnabled(enabled: boolean): void {
  MANDATORY_2FA_DEBUG_ENABLED = enabled;
}

export function mandatory2faLog(message: string, detail?: unknown): void {
  if (!MANDATORY_2FA_DEBUG_ENABLED || typeof console === "undefined" || !console.log) {
    return;
  }
  console.log(`${LOG} ${message}`, detail ?? "");
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
let authFlowInProgress = false;
let hasAuthenticatorConfigured = false;
let currentAuthFlowPassedTotp = false;
let mandatorySetupRequired = false;
let mandatoryGateReleased = false;

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

function syncGatePhaseFromState(): void {
  if (mandatoryGateReleased) {
    gatePhase = "released";
    return;
  }
  if (mandatorySetupRequired) {
    gatePhase = "blocked";
    return;
  }
  if (hasAuthenticatorConfigured && !currentAuthFlowPassedTotp) {
    gatePhase = "pending";
    return;
  }
  if (gatePhase === "released") {
    gatePhase = "idle";
  }
}

export function getMandatory2faState() {
  return {
    hasAuthenticatorConfigured,
    currentAuthFlowPassedTotp,
    mandatorySetupRequired,
    mandatoryGateReleased,
  };
}

export function mandatory2faStateLog(
  source: string,
  detail: {
    currentUrl?: string;
    requestedUrl?: string;
    finalUrl?: string;
  } = {},
): void {
  if (!MANDATORY_2FA_DEBUG_ENABLED || typeof console === "undefined" || !console.log) {
    return;
  }

  console.log("[EBvault 2FA STATE]", {
    source,
    hasAuthenticatorConfigured,
    currentAuthFlowPassedTotp,
    mandatorySetupRequired,
    mandatoryGateReleased,
    currentUrl: detail.currentUrl,
    requestedUrl: detail.requestedUrl,
    finalUrl: detail.finalUrl,
  });
}

export function markCurrentAuthFlowPassedTotp(source: string): void {
  currentAuthFlowPassedTotp = true;
  log(`current auth flow passed TOTP (${source})`);
  mandatory2faStateLog(source);
  if (hasAuthenticatorConfigured) {
    mandatoryGateReleased = true;
    mandatorySetupRequired = false;
    syncGatePhaseFromState();
    log("gate state = released");
  }
}

export function resetCurrentAuthFlowTotp(source: string): void {
  if (currentAuthFlowPassedTotp || mandatoryGateReleased) {
    log(`current auth flow TOTP reset (${source})`);
  }
  currentAuthFlowPassedTotp = false;
  mandatoryGateReleased = false;
  syncGatePhaseFromState();
  mandatory2faStateLog(source);
}

export function isMandatoryAuthFlowInProgress(): boolean {
  return authFlowInProgress;
}

export function beginMandatoryAuthFlow(reason: string): void {
  if (!authFlowInProgress) {
    log(`auth flow in progress = true (${reason})`);
  }
  authFlowInProgress = true;
}

export function finishMandatoryAuthFlow(reason: string): void {
  if (authFlowInProgress) {
    log(`auth flow in progress = false (${reason})`);
  }
  authFlowInProgress = false;
}

export function mandatory2faNavLog(
  source: string,
  detail: {
    currentUrl?: string;
    requestedUrl?: string;
    finalUrl?: string;
  },
): void {
  if (!MANDATORY_2FA_DEBUG_ENABLED || typeof console === "undefined" || !console.log) {
    return;
  }

  console.log("[EBvault 2FA NAV]", {
    source,
    currentUrl: detail.currentUrl,
    requestedUrl: detail.requestedUrl,
    finalUrl: detail.finalUrl,
    gatePhase,
    hasAuthenticatorConfigured,
    currentAuthFlowPassedTotp,
    mandatorySetupRequired,
    mandatoryGateReleased,
    authFlowInProgress,
  });
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
  hasAuthenticatorConfigured = false;
  currentAuthFlowPassedTotp = false;
  mandatorySetupRequired = false;
  mandatoryGateReleased = false;
  gatePhase = "idle";
  statusCheckPromise = null;
  log("gate state = idle (session reset)");
  mandatory2faStateLog("resetMandatoryAuthenticatorSetupState");
}

export function markMandatoryAuthenticatorSetupComplete(): void {
  hasAuthenticatorConfigured = true;
  currentAuthFlowPassedTotp = true;
  mandatorySetupRequired = false;
  mandatoryGateReleased = true;
  gatePhase = "released";
  statusCheckPromise = null;
  log("releasing gate after 2FA configured");
  mandatory2faStateLog("markMandatoryAuthenticatorSetupComplete");
}

/** @deprecated Use resetMandatoryAuthenticatorSetupState */
export function clearMandatoryAuthenticatorGuardCache(): void {
  resetMandatoryAuthenticatorSetupState();
}

export function isMandatoryAuthenticatorSetupComplete(): boolean {
  return mandatoryGateReleased;
}

export function isMandatoryAuthenticatorSetupRequired(): boolean {
  return mandatorySetupRequired;
}

export function isMandatoryLockModeActive(): boolean {
  if (mandatoryLockSuspended || mandatoryGateReleased || gatePhase === "idle") {
    return false;
  }
  return gatePhase === "pending" || gatePhase === "blocked";
}

export function isMandatoryAuthenticatorStatusKnown(): boolean {
  return mandatorySetupRequired || mandatoryGateReleased || hasAuthenticatorConfigured;
}

/** Begin post-login verification — only transitions from idle. */
export function enterPostLoginVerificationState(): void {
  if (mandatoryLockSuspended || mandatoryGateReleased) {
    return;
  }
  if (gatePhase === "idle") {
    gatePhase = "pending";
    log("enter post-login verification state");
    log("gate state = pending");
  }
}

export function confirmMandatoryAuthenticatorRequiredFromApi(): void {
  if (mandatoryLockSuspended || mandatoryGateReleased) {
    return;
  }
  hasAuthenticatorConfigured = false;
  mandatorySetupRequired = true;
  mandatoryGateReleased = false;
  gatePhase = "blocked";
  log("decision = missing authenticator (from API)");
  log("gate state = blocked");
  mandatory2faStateLog("confirmMandatoryAuthenticatorRequiredFromApi");
}

/**
 * Fail-safe when verification cannot complete: block vault access, never release.
 * Only transitions from `pending` — never downgrades `released`.
 */
export function failSafeUnresolvedGate(): void {
  if (mandatoryLockSuspended || mandatoryGateReleased || gatePhase === "blocked") {
    return;
  }

  gatePhase = "blocked";
  log("decision = unknown (fail-safe block — vault access denied)");
  log("gate state = blocked");
}

export function isVaultAccessAllowedByGate(): boolean {
  return mandatoryGateReleased;
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

export function isMandatorySetupRoute(url: string): boolean {
  return isMandatorySetupAllowedUrl(url);
}

export function isMandatoryLockExemptNavigation(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);
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
    path.startsWith("/login/")
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
  if (isMandatoryLockSuspended() || mandatoryGateReleased || gatePhase === "idle") {
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

    log("/api/two-factor response", providerList);
    hasAuthenticatorConfigured = hasEnabledAuthenticator;
    mandatorySetupRequired = !hasEnabledAuthenticator;
    mandatoryGateReleased = hasEnabledAuthenticator && currentAuthFlowPassedTotp;

    log("hasAuthenticatorConfigured", hasAuthenticatorConfigured);
    log("currentAuthFlowPassedTotp", currentAuthFlowPassedTotp);
    log("mandatorySetupRequired", mandatorySetupRequired);
    log("mandatoryGateReleased", mandatoryGateReleased);
    log("/api/two-factor result = success", {
      providers: providerList.data.map((p) => ({ type: p.type, enabled: p.enabled })),
      hasEnabledAuthenticator,
      currentAuthFlowPassedTotp,
    });

    if (mandatoryGateReleased) {
      syncGatePhaseFromState();
      log("decision = authenticator configured and current flow passed TOTP");
      log("gate state = released");
      mandatory2faStateLog("fetchMandatoryAuthenticatorStatus");
      return "released";
    }

    if (hasEnabledAuthenticator) {
      syncGatePhaseFromState();
      log("decision = authenticator configured but current flow has not passed TOTP");
      log("gate state = pending");
      mandatory2faStateLog("fetchMandatoryAuthenticatorStatus");
      return "pending";
    }

    log("decision = missing authenticator");
    syncGatePhaseFromState();
    log("gate state = blocked");
    mandatory2faStateLog("fetchMandatoryAuthenticatorStatus");
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
  if (mandatoryGateReleased) {
    return "released";
  }

  if (mandatoryLockSuspended) {
    return gatePhase;
  }

  enterPostLoginVerificationState();

  if (statusCheckPromise) {
    return statusCheckPromise;
  }

  statusCheckPromise = fetchMandatoryAuthenticatorStatus(twoFactorService).finally(() => {
    statusCheckPromise = null;
  });

  return statusCheckPromise;
}

export function isMandatoryPostLoginRouteBlocked(url: string): boolean {
  if (isMandatoryLockSuspended() || mandatoryGateReleased || gatePhase === "idle") {
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

  if (hasAuthenticatorConfigured && !currentAuthFlowPassedTotp) {
    log("route blocked — full login with TOTP required", { url });
    mandatory2faNavLog("resolveMandatoryAuthenticatorAccess/fullLoginRequired", {
      currentUrl: router.url,
      requestedUrl: url,
      finalUrl: "/login",
    });
    return router.createUrlTree(["/login"]);
  }

  if (phase === "pending") {
    failSafeUnresolvedGate();
  }

  log("route blocked — redirect to mandatory 2FA setup", { url });
  mandatory2faNavLog("resolveMandatoryAuthenticatorAccess", {
    currentUrl: router.url,
    requestedUrl: url,
    finalUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
  });
  return createMandatorySetupUrlTree(router);
}

export function createMandatorySetupUrlTree(router: Router): UrlTree {
  mandatory2faNavLog("createMandatorySetupUrlTree", {
    currentUrl: router.url,
    requestedUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
    finalUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
  });
  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}

export async function getMandatoryAuthenticatorRedirect(
  router: Router,
  twoFactorService: TwoFactorService,
): Promise<UrlTree | null> {
  if (isMandatoryLockSuspended() || mandatoryGateReleased) {
    return null;
  }

  const phase = await resolveMandatoryAuthenticatorGate(twoFactorService);

  if (phase === "released") {
    return null;
  }

  if (hasAuthenticatorConfigured && !currentAuthFlowPassedTotp) {
    mandatory2faNavLog("getMandatoryAuthenticatorRedirect/fullLoginRequired", {
      currentUrl: router.url,
      requestedUrl: "/login",
      finalUrl: "/login",
    });
    return router.createUrlTree(["/login"]);
  }

  return createMandatorySetupUrlTree(router);
}

export function shouldHideAuthenticatedContent(url: string): boolean {
  if (isMandatoryLockSuspended()) {
    return false;
  }

  if (mandatoryGateReleased || gatePhase === "idle") {
    return false;
  }

  if (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url)) {
    return false;
  }

  return gatePhase === "pending" || gatePhase === "blocked";
}
