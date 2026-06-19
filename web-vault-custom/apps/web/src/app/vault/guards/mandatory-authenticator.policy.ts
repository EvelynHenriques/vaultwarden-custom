import { Router, UrlTree } from "@angular/router";

import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

export const MANDATORY_TWO_FACTOR_SETUP_URL = "/settings/security/two-factor";

let authenticatorSetupCompleteForSession = false;

export function markMandatoryAuthenticatorSetupComplete(): void {
  authenticatorSetupCompleteForSession = true;
}

export function resetMandatoryAuthenticatorSetupState(): void {
  authenticatorSetupCompleteForSession = false;
}

/** @deprecated Use resetMandatoryAuthenticatorSetupState */
export function clearMandatoryAuthenticatorGuardCache(): void {
  resetMandatoryAuthenticatorSetupState();
}

export function isMandatoryAuthenticatorSetupComplete(): boolean {
  return authenticatorSetupCompleteForSession;
}

/** Normalize router URLs (hash routing, query strings). */
export function normalizeMandatorySetupPath(url: string): string {
  let path = url.split("?")[0].split("#")[0].trim();
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path.replace(/\/+$/, "") || "/";
}

/** Only the mandatory Authenticator setup page (and lock screen) are reachable. */
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

export async function resolveMandatoryAuthenticatorAccess(
  router: Router,
  twoFactorService: TwoFactorService,
): Promise<boolean | UrlTree> {
  if (authenticatorSetupCompleteForSession) {
    return true;
  }

  const providerList = await twoFactorService.getEnabledTwoFactorProviders();
  const hasEnabledAuthenticator = providerList.data.some(
    (provider) =>
      provider.type === TwoFactorProviderType.Authenticator && provider.enabled === true,
  );

  if (hasEnabledAuthenticator) {
    authenticatorSetupCompleteForSession = true;
    return true;
  }

  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}
