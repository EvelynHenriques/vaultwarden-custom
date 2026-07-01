import { inject } from "@angular/core";
import { CanActivateFn, Router, UrlTree } from "@angular/router";
import { firstValueFrom, map } from "rxjs";

import { VaultProfileService } from "@bitwarden/angular/vault/services/vault-profile.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import {
  SETUP_EXTENSION_DISMISSED_DISK,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  getActiveAccountUserIdOrNull,
  getAuthStatusOrNull,
} from "./mandatory-authenticator-account.util";
import {
  getMandatoryAuthenticatorRedirect,
  isMandatoryAuthFlowInProgress,
  mandatory2faDebugLog,
  mandatory2faNavLog,
  normalizeMandatorySetupPath,
} from "./mandatory-authenticator.policy";

export const SETUP_EXTENSION_DISMISSED = new UserKeyDefinition<boolean>(
  SETUP_EXTENSION_DISMISSED_DISK,
  "setupExtensionDismissed",
  {
    deserializer: (dismissed) => dismissed,
    clearOn: [],
  },
);

/**
 * Extension onboarding redirect — mandatory Authenticator 2FA enrollment takes priority.
 */
export const setupExtensionRedirectGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const accountService = inject(AccountService);
  const authService = inject(AuthService);
  const vaultProfileService = inject(VaultProfileService);
  const stateProvider = inject(StateProvider);
  const twoFactorService = inject(TwoFactorService);
  const url = state.url;

  mandatory2faDebugLog("[EBcofre GUARD TRACE] guard started: setupExtensionRedirectGuard", url);
  try {
    if (isMandatoryAuthFlowInProgress() && normalizeMandatorySetupPath(url) === "/vault") {
      mandatory2faDebugLog("[EBcofre GUARD TRACE] guard completed: setupExtensionRedirectGuard", url, {
        result: true,
        reason: "active TOTP login flow; skip setup-extension onboarding",
      });
      return true;
    }

    if (Utils.isMobileBrowser) {
      return completeGuard("setupExtensionRedirectGuard", url, true);
    }

    const userId = await getActiveAccountUserIdOrNull(accountService);
    if (!userId) {
      mandatory2faNavLog("setupExtensionRedirectGuard/noUser", {
        currentUrl: router.url,
        requestedUrl: "/login",
        finalUrl: "/login",
      });
      return completeGuard("setupExtensionRedirectGuard", url, router.createUrlTree(["/login"]));
    }

    const authStatus = await getAuthStatusOrNull(authService, userId);
    if (authStatus !== AuthenticationStatus.Unlocked) {
      return completeGuard("setupExtensionRedirectGuard", url, true);
    }

    const mandatoryRedirect = await getMandatoryAuthenticatorRedirect(router, twoFactorService);
    if (mandatoryRedirect) {
      return completeGuard("setupExtensionRedirectGuard", url, mandatoryRedirect);
    }

    const dismissedExtensionPage = await firstValueFrom(
      stateProvider
        .getUser(userId, SETUP_EXTENSION_DISMISSED)
        .state$.pipe(map((dismissed) => dismissed ?? false)),
    );

    const isProfileOlderThan30Days = await profileIsOlderThan30Days(
      vaultProfileService,
      userId,
    ).catch(() => true);

    if (dismissedExtensionPage || isProfileOlderThan30Days) {
      return completeGuard("setupExtensionRedirectGuard", url, true);
    }

    mandatory2faNavLog("setupExtensionRedirectGuard/setupExtension", {
      currentUrl: router.url,
      requestedUrl: "/setup-extension",
      finalUrl: "/setup-extension",
    });
    return completeGuard("setupExtensionRedirectGuard", url, router.createUrlTree(["/setup-extension"]));
  } catch (error) {
    mandatory2faDebugLog("[EBcofre GUARD TRACE] guard failed: setupExtensionRedirectGuard", url, {
      error,
    });
    throw error;
  }
};

/** Blocks direct navigation to /setup-extension until mandatory Authenticator 2FA is configured. */
export const blockSetupExtensionUntilMandatory2faGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const accountService = inject(AccountService);
  const authService = inject(AuthService);
  const twoFactorService = inject(TwoFactorService);

  const userId = await getActiveAccountUserIdOrNull(accountService);
  const authStatus = await getAuthStatusOrNull(authService, userId);
  if (authStatus !== AuthenticationStatus.Unlocked) {
    return true;
  }

  const mandatoryRedirect = await getMandatoryAuthenticatorRedirect(router, twoFactorService);
  return mandatoryRedirect ?? true;
};

function completeGuard(name: string, url: string, result: boolean | UrlTree): boolean | UrlTree {
  mandatory2faDebugLog("[EBcofre GUARD TRACE] guard completed:", name, url, {
    result: result === true ? true : result === false ? false : "UrlTree",
  });
  return result;
}

async function profileIsOlderThan30Days(
  vaultProfileService: VaultProfileService,
  userId: string,
): Promise<boolean> {
  const creationDate = await vaultProfileService.getProfileCreationDate(userId);
  return isMoreThan30DaysAgo(creationDate);
}

function isMoreThan30DaysAgo(date?: string | Date): boolean {
  if (!date) {
    return false;
  }

  const inputDate = new Date(date).getTime();
  const today = new Date().getTime();
  const differenceInMS = today - inputDate;
  const msInADay = 1000 * 60 * 60 * 24;
  const differenceInDays = Math.round(differenceInMS / msInADay);

  return differenceInDays > 30;
}
