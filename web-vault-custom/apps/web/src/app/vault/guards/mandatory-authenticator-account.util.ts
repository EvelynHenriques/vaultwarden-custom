import { firstValueFrom, map, Observable, distinctUntilChanged } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";

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

/** Bitwarden getUserId() throws when account is null — use these safe helpers instead. */
export function activeAccountUserId$(
  accountService: AccountService,
): Observable<string | null> {
  return accountService.activeAccount$.pipe(
    map((account) => account?.id ?? null),
    distinctUntilChanged(),
  );
}

export async function getActiveAccountUserIdOrNull(
  accountService: AccountService,
): Promise<string | null> {
  const account = await firstValueFrom(accountService.activeAccount$);
  return account?.id ?? null;
}

export async function getAuthStatusOrNull(
  authService: AuthService,
  userId: string | null,
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
  userId: string | null;
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
