import { inject } from "@angular/core";
import { CanActivateChildFn, CanActivateFn, Router } from "@angular/router";

import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  createMandatorySetupUrlTree,
  isMandatoryLockExemptNavigation,
  isMandatoryLockModeActive,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  resolveMandatoryAuthenticatorAccess,
} from "./mandatory-authenticator.policy";

export {
  clearMandatoryAuthenticatorGuardCache,
  markMandatoryAuthenticatorSetupComplete,
  resetMandatoryAuthenticatorSetupState,
} from "./mandatory-authenticator.policy";

async function evaluateMandatoryAuthenticatorAccess(
  url: string,
): Promise<boolean | import("@angular/router").UrlTree> {
  const router = inject(Router) as Router;
  const twoFactorService = inject(TwoFactorService) as TwoFactorService;

  // Synchronous default-deny: block before async 2FA status refresh completes.
  if (
    isMandatoryLockModeActive() &&
    !isMandatorySetupAllowedUrl(url) &&
    !isMandatoryLockExemptNavigation(url)
  ) {
    return createMandatorySetupUrlTree(router);
  }

  try {
    return await resolveMandatoryAuthenticatorAccess(router, twoFactorService, url);
  } catch {
    return createMandatorySetupUrlTree(router);
  }
}

/** Blocks every authenticated descendant route until Authenticator 2FA is configured. */
export const mandatoryAuthenticatorGuard: CanActivateChildFn = async (_route, state) => {
  return evaluateMandatoryAuthenticatorAccess(state.url);
};

/** Same policy for routes that define their own canActivate. */
export const mandatoryAuthenticatorActivate: CanActivateFn = async (_route, state) => {
  return evaluateMandatoryAuthenticatorAccess(state.url);
};

export { MANDATORY_TWO_FACTOR_SETUP_URL };
