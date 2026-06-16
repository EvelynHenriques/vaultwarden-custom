import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";

import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

const TWO_FACTOR_SETUP_SEGMENT = "/settings/security/two-factor";

/** Set after authenticator is confirmed enabled; avoids repeated API calls this session. */
let authenticatorSetupComplete = false;

/** Call after enabling authenticator if navigation does not re-run the guard immediately. */
export function clearMandatoryAuthenticatorGuardCache(): void {
  authenticatorSetupComplete = false;
}

function isTwoFactorSetupRoute(url: string): boolean {
  // Works with and without a Vaultwarden DOMAIN_PATH prefix (e.g. /vw/settings/...).
  return url.includes(TWO_FACTOR_SETUP_SEGMENT);
}

export const mandatoryAuthenticatorGuard: CanActivateFn = async (_route, state) => {
  if (authenticatorSetupComplete || isTwoFactorSetupRoute(state.url)) {
    return true;
  }

  const router = inject(Router) as Router;
  const twoFactorService = inject(TwoFactorService) as TwoFactorService;

  try {
    const providerList = await twoFactorService.getEnabledTwoFactorProviders();
    const hasEnabledAuthenticator = providerList.data.some(
      (provider) =>
        provider.type === TwoFactorProviderType.Authenticator && provider.enabled === true,
    );

    if (hasEnabledAuthenticator) {
      authenticatorSetupComplete = true;
      return true;
    }

    return router.createUrlTree(["/settings/security/two-factor"]);
  } catch {
    // UX-only guard: do not hard-block the app if the API is unreachable.
    // Server-side auth in Vaultwarden still enforces the policy.
    return true;
  }
};
