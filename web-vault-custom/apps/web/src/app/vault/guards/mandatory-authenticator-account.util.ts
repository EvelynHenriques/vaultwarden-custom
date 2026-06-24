import { firstValueFrom, Observable, distinctUntilChanged } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { UserId } from "@bitwarden/common/types/guid";

import {
  isLogoutNavigationTarget,
  isMandatoryLockExemptNavigation,
  isMandatoryLockSuspended,
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryAuthenticatorSetupRequired,
  isMandatoryAuthenticatorStatusKnown,
  normalizeMandatorySetupPath,
} from "./mandatory-authenticator.policy";

const LOG_PREFIX = "[Mandatory2FA]";

/** Safe alternative to getUserId — returns null instead of throwing when account is absent. */
export function activeAccountUserId$(
  accountService: AccountService,
): Observable<UserId | null> {
  return accountService.activeAccount$.pipe(getOptionalUserId, distinctUntilChanged());
}

export async function getActiveAccountUserIdOrNull(
  accountService: AccountService,
): Promise<UserId | null> {
  return firstValueFrom(accountService.activeAccount$.pipe(getOptionalUserId));
}

export async function getAuthStatusOrNull(
  authService: AuthService,
  userId: UserId | null,
): Promise<AuthenticationStatus | null> {
  if (!userId) {
    return null;
  }
  return firstValueFrom(authService.authStatusFor$(userId));
}

export type MandatoryGuardContext = {
  url: string;
  path: string;
  hasAccount: boolean;
  userId: UserId | null;
  authStatus: AuthenticationStatus | null;
  isPublicRoute: boolean;
  isLogoutRoute: boolean;
  lockSuspended: boolean;
  vaultLocked: boolean;
  twoFactorConfigured: boolean;
  twoFactorStatusLoading: boolean;
};

export async function buildMandatoryGuardContext(
  accountService: AccountService,
  authService: AuthService,
  url: string,
): Promise<MandatoryGuardContext> {
  const path = normalizeMandatorySetupPath(url);
  const lockSuspended = isMandatoryLockSuspended();
  const isLogoutRoute = isLogoutNavigationTarget(url);
  const isPublicRoute = isMandatoryLockExemptNavigation(url);
  const userId = await getActiveAccountUserIdOrNull(accountService);
  const authStatus = await getAuthStatusOrNull(authService, userId);
  const vaultLocked = authStatus === AuthenticationStatus.Locked;
  const twoFactorConfigured = isMandatoryAuthenticatorSetupComplete();
  const twoFactorStatusLoading =
    userId != null &&
    authStatus === AuthenticationStatus.Unlocked &&
    !isMandatoryAuthenticatorStatusKnown() &&
    !twoFactorConfigured;

  return {
    url,
    path,
    hasAccount: userId != null,
    userId,
    authStatus,
    isPublicRoute,
    isLogoutRoute,
    lockSuspended,
    vaultLocked,
    twoFactorConfigured,
    twoFactorStatusLoading,
  };
}

export function logMandatoryGuardDecision(
  decision: string,
  context: MandatoryGuardContext,
  extra?: Record<string, unknown>,
): void {
  if (typeof console === "undefined" || !console.debug) {
    return;
  }

  console.debug(`${LOG_PREFIX} guard decision: ${decision}`, {
    route: context.path,
    isPublicRoute: context.isPublicRoute,
    isLogoutRoute: context.isLogoutRoute,
    lockSuspended: context.lockSuspended,
    hasAccount: context.hasAccount,
    userId: context.userId,
    authStatus: context.authStatus,
    vaultLocked: context.vaultLocked,
    twoFactorConfigured: context.twoFactorConfigured,
    twoFactorStatusLoading: context.twoFactorStatusLoading,
    mandatorySetupRequired: isMandatoryAuthenticatorSetupRequired(),
    ...extra,
  });
}
