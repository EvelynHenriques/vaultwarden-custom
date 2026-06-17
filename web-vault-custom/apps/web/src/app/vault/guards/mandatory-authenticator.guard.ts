import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";

import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  resolveMandatoryAuthenticatorAccess,
} from "./mandatory-authenticator.policy";

export {
  clearMandatoryAuthenticatorGuardCache,
  markMandatoryAuthenticatorSetupComplete,
  resetMandatoryAuthenticatorSetupState,
} from "./mandatory-authenticator.policy";

export const mandatoryAuthenticatorGuard: CanActivateFn = async (_route, state) => {
  if (isMandatorySetupAllowedUrl(state.url)) {
    return true;
  }

  const router = inject(Router) as Router;
  const twoFactorService = inject(TwoFactorService) as TwoFactorService;

  try {
    return await resolveMandatoryAuthenticatorAccess(router, twoFactorService);
  } catch {
    // Fail closed: keep the user on the setup flow when state cannot be verified.
    return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
  }
};
