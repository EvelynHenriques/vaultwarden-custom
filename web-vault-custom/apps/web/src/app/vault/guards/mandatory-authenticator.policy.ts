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

/** Routes reachable while mandatory Authenticator setup is pending. */
export function isMandatorySetupAllowedUrl(url: string): boolean {
  const path = url.split("?")[0];
  return (
    path.includes(MANDATORY_TWO_FACTOR_SETUP_URL) ||
    path.startsWith("/settings/security") ||
    path === "/settings" ||
    path === "/lock"
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
