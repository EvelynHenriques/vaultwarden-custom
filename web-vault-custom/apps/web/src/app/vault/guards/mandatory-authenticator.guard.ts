import { inject } from "@angular/core";
import { CanActivateChildFn, CanActivateFn, Router } from "@angular/router";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  buildMandatoryGuardContext,
  logMandatoryGuardDecision,
} from "./mandatory-authenticator-account.util";
import {
  createMandatorySetupUrlTree,
  getMandatory2faState,
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
 * 1. Logout/disconnect or suspended lock → allow
 * 2. Public/auth routes (login, register, verify, lock, …) → allow (no account required)
 * 3. No account / LoggedOut → allow (authGuard owns login redirect)
 * 4. Vault Locked → allow (unlock flow — distinct from missing setup)
 * 5. Unlocked without Authenticator → redirect to setup
 * 6. Unlocked with Authenticator → allow
 */
async function evaluateMandatoryAuthenticatorAccess(
  url: string,
): Promise<boolean | import("@angular/router").UrlTree> {
  const accountService = inject(AccountService) as AccountService;
  const authService = inject(AuthService) as AuthService;
  const router = inject(Router) as Router;
  const twoFactorService = inject(TwoFactorService) as TwoFactorService;

  const ctx = await buildMandatoryGuardContext(accountService, authService, url);

  if (ctx.lockSuspended || ctx.isLogoutRoute) {
    logMandatoryGuardDecision("allow — logout/disconnect or lock suspended", ctx);
    return true;
  }

  if (ctx.isMandatorySetupRoute) {
    if (!ctx.hasAccount || !ctx.userId) {
      logMandatoryGuardDecision("allow — setup route before account is ready", ctx);
      return true;
    }

    if (ctx.authStatus === AuthenticationStatus.LoggedOut) {
      logMandatoryGuardDecision("allow — logged out setup route transition", ctx);
      return true;
    }

    const state = getMandatory2faState();
    if (
      state.currentAuthFlowPassedTotp &&
      !state.mandatorySetupRequired &&
      !state.mandatoryGateReleased
    ) {
      console.log("[EBvault 2FA] gate pending - no setup route decision yet", {
        route: ctx.path,
        hasAuthenticatorConfigured: state.hasAuthenticatorConfigured,
        currentAuthFlowPassedTotp: state.currentAuthFlowPassedTotp,
        mandatorySetupRequired: state.mandatorySetupRequired,
        mandatoryGateReleased: state.mandatoryGateReleased,
      });
      logMandatoryGuardDecision("cancel - setup route requested while TOTP login gate pending", ctx, state);
      return false;
    }

    console.log("[EBvault 2FA] allow mandatory setup route", {
      route: ctx.path,
      hasAccount: ctx.hasAccount,
      hasAuthenticatorConfigured: state.hasAuthenticatorConfigured,
      mandatorySetupRequired: state.mandatorySetupRequired,
    });
    logMandatoryGuardDecision("allow — mandatory setup route", ctx, state);
    return true;
  }

  if (ctx.isPublicRoute) {
    logMandatoryGuardDecision("allow — public/auth route (no account required)", ctx);
    return true;
  }

  if (!ctx.hasAccount || !ctx.userId) {
    logMandatoryGuardDecision("allow — no account yet (unauthenticated transition)", ctx);
    return true;
  }

  if (ctx.authStatus === AuthenticationStatus.LoggedOut) {
    logMandatoryGuardDecision("allow — logged out", ctx);
    return true;
  }

  if (ctx.authStatus === AuthenticationStatus.Locked) {
    logMandatoryGuardDecision("allow — vault locked (unlock / login 2FA flow)", ctx);
    return true;
  }

  if (ctx.authStatus !== AuthenticationStatus.Unlocked) {
    logMandatoryGuardDecision("allow — auth status not Unlocked yet", ctx, {
      authStatus: ctx.authStatus,
    });
    return true;
  }

  try {
    const result = await resolveMandatoryAuthenticatorAccess(router, twoFactorService, url);
    logMandatoryGuardDecision(
      typeof result === "boolean" && result ? "allow — vault access granted" : "redirect/setup",
      ctx,
      { result: typeof result === "boolean" ? result : MANDATORY_TWO_FACTOR_SETUP_URL },
    );
    return result;
  } catch (error) {
    logMandatoryGuardDecision("redirect — guard error during 2FA check", ctx, {
      error: String(error),
    });
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
