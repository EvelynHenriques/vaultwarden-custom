import { inject } from "@angular/core";
import { CanActivateChildFn, Router } from "@angular/router";

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

/** Blocks every authenticated route until Authenticator 2FA is configured. */
export const mandatoryAuthenticatorGuard: CanActivateChildFn = async (_route, state) => {
  if (isMandatorySetupAllowedUrl(state.url)) {
    return true;
  }

  const router = inject(Router) as Router;
  const twoFactorService = inject(TwoFactorService) as TwoFactorService;

  try {
    return await resolveMandatoryAuthenticatorAccess(router, twoFactorService);
  } catch {
    return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
  }
};
