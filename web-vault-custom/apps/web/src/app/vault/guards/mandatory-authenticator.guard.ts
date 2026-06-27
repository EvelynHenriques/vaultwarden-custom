import { inject } from "@angular/core";
import { CanActivateChildFn, CanActivateFn, Router, UrlTree } from "@angular/router";

import {
  createMandatorySetupUrlTree,
  getMandatory2faMode,
  getMandatory2faState,
  getMandatoryGatePhase,
  isLogoutNavigationTarget,
  isMandatory2faEnforcementEnabled,
  isMandatoryLockExemptNavigation,
  isMandatoryLockSuspended,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  mandatory2faLog,
  mandatory2faNavLog,
} from "./mandatory-authenticator.policy";

export {
  clearMandatoryAuthenticatorGuardCache,
  markMandatoryAuthenticatorSetupComplete,
  resetMandatoryAuthenticatorSetupState,
} from "./mandatory-authenticator.policy";

function evaluateMandatoryAuthenticatorAccess(url: string): boolean | UrlTree {
  const router = inject(Router) as Router;
  const state = getMandatory2faState();
  const gatePhase = getMandatoryGatePhase();
  const mode = getMandatory2faMode();

  logGuardState("entered", router, url);

  if (!isMandatory2faEnforcementEnabled()) {
    mandatory2faLog(`${mode} mode: mandatory Authenticator guard allows route`, { url });
    return allowTrue(router, url, "mode disabled or observe-only");
  }

  if (
    isMandatoryLockSuspended() ||
    isLogoutNavigationTarget(url) ||
    isMandatoryLockExemptNavigation(url)
  ) {
    return allowTrue(router, url, "logout/public/pre-login route");
  }

  if (isMandatorySetupAllowedUrl(url)) {
    console.log("[EBvault 2FA SETUP] allowing mandatory setup route", {
      url,
      gatePhase,
      mandatorySetupRequired: state.mandatorySetupRequired,
    });
    console.log("[EBvault 2FA SETUP] /settings parent guard allow setup route");
    console.log("[EBvault 2FA SETUP] /settings/security parent guard allow setup route");
    console.log("[EBvault 2FA SETUP] /settings/security/two-factor route allowed");
    console.log("[EBvault 2FA SETUP] setup route allowed");
    return allowTrue(router, url, "mandatory setup route");
  }

  if (state.mandatoryGateReleased) {
    return allowTrue(router, url, "gate released");
  }

  if (state.hasAuthenticatorConfigured && !state.currentAuthFlowPassedTotp) {
    mandatory2faLog("route blocked - full login with TOTP required", { url });
    const tree = router.createUrlTree(["/login"]);
    logGuardReturn(router, url, tree, "full login required");
    return tree;
  }

  if (state.mandatorySetupRequired) {
    mandatory2faLog("route blocked - redirect to mandatory 2FA setup", { url });
    const tree = createMandatorySetupUrlTree(router);
    logGuardReturn(router, url, tree, MANDATORY_TWO_FACTOR_SETUP_URL);
    return tree;
  }

  if (gatePhase === "pending" && !state.currentAuthFlowPassedTotp) {
    console.log("[EBvault 2FA SETUP] blocked navigation away from setup until Authenticator is configured", {
      url,
      gatePhase,
      state,
    });
    mandatory2faLog("gate pending - protected navigation paused until /api/two-factor resolves", {
      url,
      gatePhase,
      state,
    });
    logGuardReturn(router, url, false, "pending no-TOTP verification");
    return false;
  }

  // Pending with currentAuthFlowPassedTotp=true is the frozen golden path:
  // let original Web Vault login navigation complete.
  mandatory2faLog("gate pending/idle - guard allows original navigation to settle", {
    url,
    gatePhase,
    state,
  });
  return allowTrue(router, url, "pending/idle");
}

export const mandatoryAuthenticatorGuard: CanActivateChildFn = (_route, state) => {
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorGuard entered", { url: state.url });
  const result = evaluateMandatoryAuthenticatorAccess(state.url);
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorGuard returning to Angular", {
    url: state.url,
    ...describeGuardResult(result),
  });
  return result;
};

export const mandatoryAuthenticatorActivate: CanActivateFn = (_route, state) => {
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorActivate entered", {
    url: state.url,
  });
  const result = evaluateMandatoryAuthenticatorAccess(state.url);
  console.log("[EBvault OUTER GUARD] mandatoryAuthenticatorActivate returning to Angular", {
    url: state.url,
    ...describeGuardResult(result),
  });
  return result;
};

export { MANDATORY_TWO_FACTOR_SETUP_URL };

function allowTrue(router: Router, url: string, reason: string): true {
  logGuardReturn(router, url, true, reason);
  return true;
}

function logGuardState(source: string, router: Router, stateUrl: string): void {
  const state = getMandatory2faState();
  const windowRef = typeof window === "undefined" ? null : window;
  console.log("[EBvault ROUTER DEBUG]", {
    source,
    routerUrl: router.url,
    stateUrl,
    windowLocationHref: windowRef?.location?.href,
    windowLocationHash: windowRef?.location?.hash,
    gatePhase: getMandatoryGatePhase(),
    mode: getMandatory2faMode(),
    ...state,
  });
}

function logGuardReturn(
  router: Router,
  url: string,
  result: boolean | UrlTree,
  reason: string,
): void {
  const detail = {
    currentUrl: router.url,
    requestedUrl: url,
    finalUrl: result === true ? url : result.toString?.(),
  };
  mandatory2faNavLog(`mandatoryAuthenticatorGuard/${reason}`, detail);
  console.log("[EBvault GUARD TRACE] returning to Angular", {
    url,
    reason,
    ...describeGuardResult(result),
  });
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
