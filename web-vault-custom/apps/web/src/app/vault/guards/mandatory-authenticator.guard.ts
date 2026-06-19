import { inject } from "@angular/core";
import { CanActivateChildFn, CanActivateFn, Router } from "@angular/router";

import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryAuthenticatorSetupRequired,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  resolveMandatoryAuthenticatorAccess,
} from "./mandatory-authenticator.policy";

export {
  clearMandatoryAuthenticatorGuardCache,
  markMandatoryAuthenticatorSetupComplete,
  resetMandatoryAuthenticatorSetupState,
} from "./mandatory-authenticator.policy";

async function evaluateMandatoryAuthenticatorAccess(url: string): Promise<boolean | import("@angular/router").UrlTree> {
  if (isMandatorySetupAllowedUrl(url)) {
    return true;
  }

  if (isMandatoryAuthenticatorSetupComplete()) {
    return true;
  }

  const router = inject(Router) as Router;

  if (isMandatoryAuthenticatorSetupRequired()) {
    return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
  }

  const twoFactorService = inject(TwoFactorService) as TwoFactorService;
  return resolveMandatoryAuthenticatorAccess(router, twoFactorService);
}

/** Blocks every authenticated route until Authenticator 2FA is configured. */
export const mandatoryAuthenticatorGuard: CanActivateChildFn = async (_route, state) => {
  try {
    return await evaluateMandatoryAuthenticatorAccess(state.url);
  } catch {
    const router = inject(Router) as Router;
    return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
  }
};

/** Same policy for routes that define their own canActivate (vault, sends, tools, orgs). */
export const mandatoryAuthenticatorActivate: CanActivateFn = async (_route, state) => {
  try {
    return await evaluateMandatoryAuthenticatorAccess(state.url);
  } catch {
    const router = inject(Router) as Router;
    return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
  }
};
