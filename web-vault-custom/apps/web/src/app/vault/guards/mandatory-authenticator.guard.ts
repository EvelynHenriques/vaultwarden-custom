import { inject } from "@angular/core";
import { CanActivateChildFn, CanActivateFn, Router, UrlTree } from "@angular/router";

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

async function evaluateMandatoryAuthenticatorAccess(url: string): Promise<boolean | UrlTree> {
  const accountService = inject(AccountService) as AccountService;
  const authService = inject(AuthService) as AuthService;
  const router = inject(Router) as Router;
  const twoFactorService = inject(TwoFactorService) as TwoFactorService;

  const ctx = await buildMandatoryGuardContext(accountService, authService, url);

  if (ctx.lockSuspended || ctx.isLogoutRoute) {
    logMandatoryGuardDecision("allow - logout/disconnect or lock suspended", ctx);
    return allowTrue("logout/disconnect or lock suspended", ctx.path);
  }

  if (ctx.isMandatorySetupRoute) {
    if (!ctx.hasAccount || !ctx.userId) {
      logMandatoryGuardDecision("allow - setup route before account is ready", ctx);
      return allowTrue("mandatory setup route before account is ready", ctx.path);
    }

    if (ctx.authStatus === AuthenticationStatus.LoggedOut) {
      logMandatoryGuardDecision("allow - logged out setup route transition", ctx);
      return allowTrue("logged out setup route transition", ctx.path);
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
      logMandatoryGuardDecision(
        "cancel - setup route requested while TOTP login gate pending",
        ctx,
        state,
      );
      console.log("[EBvault GUARD TRACE] returning false now for pending setup route", {
        route: ctx.path,
      });
      return false;
    }

    console.log("[EBvault 2FA] allow mandatory setup route", {
      route: ctx.path,
      hasAccount: ctx.hasAccount,
      hasAuthenticatorConfigured: state.hasAuthenticatorConfigured,
      mandatorySetupRequired: state.mandatorySetupRequired,
    });
    logMandatoryGuardDecision("allow - mandatory setup route", ctx, state);
    return allowTrue("mandatory setup route", ctx.path);
  }

  if (ctx.isPublicRoute) {
    logMandatoryGuardDecision("allow - public/auth route (no account required)", ctx);
    return allowTrue("public/auth route", ctx.path);
  }

  if (!ctx.hasAccount || !ctx.userId) {
    logMandatoryGuardDecision("allow - no account yet (unauthenticated transition)", ctx);
    return allowTrue("no account yet", ctx.path);
  }

  if (ctx.authStatus === AuthenticationStatus.LoggedOut) {
    logMandatoryGuardDecision("allow - logged out", ctx);
    return allowTrue("logged out", ctx.path);
  }

  if (ctx.authStatus === AuthenticationStatus.Locked) {
    logMandatoryGuardDecision("allow - vault locked (unlock / login 2FA flow)", ctx);
    return allowTrue("vault locked", ctx.path);
  }

  if (ctx.authStatus !== AuthenticationStatus.Unlocked) {
    logMandatoryGuardDecision("allow - auth status not Unlocked yet", ctx, {
      authStatus: ctx.authStatus,
    });
    return allowTrue("auth status not unlocked yet", ctx.path);
  }

  try {
    const result = await resolveMandatoryAuthenticatorAccess(router, twoFactorService, url);
    logMandatoryGuardDecision(
      result === true ? "allow - vault access granted" : "redirect/setup",
      ctx,
      { result: typeof result === "boolean" ? result : MANDATORY_TWO_FACTOR_SETUP_URL },
    );

    if (result === true) {
      return allowTrue("vault route", ctx.path);
    }
    if (result === false) {
      console.log("[EBvault GUARD TRACE] returning false now for route", { route: ctx.path });
      return false;
    }

    console.log("[EBvault GUARD TRACE] about to return UrlTree", {
      route: ctx.path,
      result: MANDATORY_TWO_FACTOR_SETUP_URL,
    });
    return result;
  } catch (error) {
    logMandatoryGuardDecision("redirect - guard error during 2FA check", ctx, {
      error: String(error),
    });
    const tree = createMandatorySetupUrlTree(router);
    console.log("[EBvault GUARD TRACE] about to return UrlTree", {
      route: ctx.path,
      result: MANDATORY_TWO_FACTOR_SETUP_URL,
      reason: "guard error",
    });
    return tree;
  }
}

export const mandatoryAuthenticatorGuard: CanActivateChildFn = async (_route, state) => {
  const router = inject(Router) as Router;
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorGuard entered", { url: state.url });
  logRouterDebug("mandatoryAuthenticatorGuard entered", router, state.url);
  const result = await traceMandatoryGuard("mandatoryAuthenticatorGuard", state.url, () =>
    evaluateMandatoryAuthenticatorAccess(state.url),
  );
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorGuard returning to Angular", {
    url: state.url,
    ...describeGuardResult(result),
  });
  logRouterDebug("mandatoryAuthenticatorGuard returning", router, state.url, result);
  return result;
};

export const mandatoryAuthenticatorActivate: CanActivateFn = async (_route, state) => {
  const router = inject(Router) as Router;
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorActivate entered", {
    url: state.url,
  });
  logRouterDebug("mandatoryAuthenticatorActivate entered", router, state.url);
  const result = await traceMandatoryGuard("mandatoryAuthenticatorActivate", state.url, () =>
    evaluateMandatoryAuthenticatorAccess(state.url),
  );
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorActivate returning to Angular", {
    url: state.url,
    ...describeGuardResult(result),
  });
  logRouterDebug("mandatoryAuthenticatorActivate returning", router, state.url, result);
  return result;
};

export { MANDATORY_TWO_FACTOR_SETUP_URL };

async function traceMandatoryGuard(
  name: string,
  url: string,
  run: () => Promise<boolean | UrlTree>,
): Promise<boolean | UrlTree> {
  console.log("[EBvault GUARD TRACE] guard started:", name, url);
  try {
    const result = await run();
    console.log("[EBvault GUARD TRACE] guard completed:", name, url, {
      result: result === true ? true : result === false ? false : "UrlTree",
    });
    return result;
  } catch (error) {
    console.log("[EBvault GUARD TRACE] guard failed:", name, url, { error });
    throw error;
  }
}

function allowTrue(reason: string, route: string): true {
  console.log("[EBvault GUARD TRACE] returning true now", {
    route,
    reason,
  });
  return true;
}

function describeGuardResult(result: boolean | UrlTree): Record<string, unknown> {
  if (result === true) {
    return { resultType: "true", resultString: "true" };
  }
  if (result === false) {
    return { resultType: "false", resultString: "false" };
  }

  return {
    resultType: result?.constructor?.name ?? "UrlTree",
    resultString: result?.toString?.(),
  };
}

function logRouterDebug(
  source: string,
  router: Router,
  stateUrl: string,
  result?: boolean | UrlTree,
): void {
  const windowRef = typeof window === "undefined" ? null : window;
  console.log("[EBvault ROUTER DEBUG]", {
    source,
    routerUrl: router.url,
    stateUrl,
    windowLocationHref: windowRef?.location?.href,
    windowLocationHash: windowRef?.location?.hash,
    generatedUrlTreeString:
      result != null && result !== true && result !== false ? result.toString?.() : undefined,
  });
}
