import { Router, UrlTree } from "@angular/router";

import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

/** Only whitelisted authenticated route while mandatory Authenticator 2FA is pending. */
export const MANDATORY_TWO_FACTOR_SETUP_URL = "/settings/security/two-factor";

let authenticatorSetupCompleteForSession = false;
let mandatoryAuthenticatorRequired = false;
let providerStatusKnown = false;
let statusCheckPromise: Promise<void> | null = null;

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
 * - /lock (vault lock screen; user remains authenticated)
 */
export function isMandatorySetupAllowedUrl(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  if (path === "/lock") {
    return true;
  }

  return (
    path === MANDATORY_TWO_FACTOR_SETUP_URL ||
    path.startsWith(`${MANDATORY_TWO_FACTOR_SETUP_URL}/`)
  );
}

/** Default-deny: block unless 2FA is complete or URL is explicitly whitelisted. */
export function shouldBlockMandatorySetupNavigation(url: string): boolean {
  if (isMandatoryAuthenticatorSetupComplete()) {
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

  if (isMandatoryAuthenticatorSetupComplete()) {
    return true;
  }

  if (url && isMandatorySetupAllowedUrl(url)) {
    return true;
  }

  return createMandatorySetupUrlTree(router);
}

export function createMandatorySetupUrlTree(router: Router): UrlTree {
  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}
