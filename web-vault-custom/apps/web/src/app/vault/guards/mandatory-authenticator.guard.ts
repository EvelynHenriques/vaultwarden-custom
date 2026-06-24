import { inject } from "@angular/core";
import { CanActivateChildFn, CanActivateFn, Router } from "@angular/router";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  createMandatorySetupUrlTree,
  isLogoutNavigationTarget,
  isMandatoryLockSuspended,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  resolveMandatoryAuthenticatorAccess,
} from "./mandatory-authenticator.policy";

export {
  clearMandatoryAuthenticatorGuardCache,
  markMandatoryAuthenticatorSetupComplete,
  resetMandatoryAuthenticatorSetupState,
} from "./mandatory-authenticator.policy";

/**
 * Mandatory 2FA route guard — evaluated after authGuard on authenticated routes.
 *
 * Priority (highest first):
 * 1. Logout/disconnect routes or suspended lock → allow
 * 2. No active account / LoggedOut → allow (authGuard owns login redirect)
 * 3. Vault Locked → allow (unlock flow / login 2FA — distinct from missing setup)
 * 4. Unlocked without Authenticator → redirect to setup
 * 5. Unlocked with Authenticator → allow
 */
async function evaluateMandatoryAuthenticatorAccess(
  url: string,
): Promise<boolean | import("@angular/router").UrlTree> {
  if (isMandatoryLockSuspended() || isLogoutNavigationTarget(url)) {
    return true;
  }

  const accountService = inject(AccountService) as AccountService;
  const authService = inject(AuthService) as AuthService;
  const userId = await firstValueFrom(getUserId(accountService.activeAccount$));

  if (!userId) {
    return true;
  }

  const status = await firstValueFrom(authService.authStatusFor$(userId));

  if (status === AuthenticationStatus.LoggedOut) {
    return true;
  }

  if (status === AuthenticationStatus.Locked) {
    return true;
  }

  if (status !== AuthenticationStatus.Unlocked) {
    return true;
  }

  const router = inject(Router) as Router;
  const twoFactorService = inject(TwoFactorService) as TwoFactorService;

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
