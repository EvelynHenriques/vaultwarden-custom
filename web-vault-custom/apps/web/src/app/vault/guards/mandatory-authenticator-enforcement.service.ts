import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { EMPTY, distinctUntilChanged, switchMap } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  activeAccountUserId$,
  getActiveAccountUserIdOrNull,
  getAuthStatusOrNull,
} from "./mandatory-authenticator-account.util";
import { MandatoryAuthenticatorLockService } from "./mandatory-authenticator-lock.service";
import {
  confirmMandatoryAuthenticatorRequiredFromApi,
  ensureMandatoryAuthenticatorStatus,
  isMandatoryAuthenticatorSetupApiError,
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryAuthenticatorSetupRequired,
  isMandatoryLockModeActive,
  isMandatoryLockSuspended,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  normalizeMandatorySetupPath,
  resumeMandatoryLock,
  shouldHideAuthenticatedContent,
} from "./mandatory-authenticator.policy";

/**
 * Central mandatory-2FA orchestrator.
 *
 * - Resolves 2FA status once per unlock (before sync / post-login navigation).
 * - Route guards own all navigation redirects.
 * - Delegates UI lock behaviour to MandatoryAuthenticatorLockService.
 */
@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorEnforcementService {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly twoFactorService = inject(TwoFactorService);
  private readonly lockService = inject(MandatoryAuthenticatorLockService);

  private started = false;
  private sessionResolveInFlight: Promise<void> | null = null;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.lockService.initializeUi();

    activeAccountUserId$(this.accountService)
      .pipe(
        switchMap((userId) => {
          if (!userId) {
            return EMPTY;
          }
          return this.authService.authStatusFor$(userId).pipe(distinctUntilChanged());
        }),
      )
      .subscribe((status) => {
        if (status === AuthenticationStatus.LoggedOut) {
          this.lockService.prepareForLogout();
          return;
        }

        if (status === AuthenticationStatus.Unlocked) {
          void this.onSessionUnlocked();
        }
      });

    void this.onSessionUnlocked();
  }

  shouldHideAuthenticatedContent(url: string): boolean {
    return shouldHideAuthenticatedContent(url);
  }

  /**
   * Keeps the session alive when the server blocks a vault API for missing Authenticator 2FA.
   * Generic auth failures are not intercepted.
   */
  async handleAuthFailure(signal?: Record<string, unknown>): Promise<boolean> {
    if (isMandatoryLockSuspended() || !isMandatoryAuthenticatorSetupApiError(signal)) {
      return false;
    }

    const userId = await getActiveAccountUserIdOrNull(this.accountService);
    if (!userId) {
      return false;
    }

    const authStatus = await getAuthStatusOrNull(this.authService, userId);
    if (authStatus !== AuthenticationStatus.Unlocked) {
      return false;
    }

    if (isMandatoryAuthenticatorSetupComplete()) {
      return false;
    }

    confirmMandatoryAuthenticatorRequiredFromApi();
    await this.resolveUnlockedSession();

    if (isMandatoryAuthenticatorSetupComplete() || !isMandatoryAuthenticatorSetupRequired()) {
      return false;
    }

    const currentPath = normalizeMandatorySetupPath(this.router.url);
    if (!isMandatorySetupAllowedUrl(currentPath)) {
      await this.router.navigate([MANDATORY_TWO_FACTOR_SETUP_URL], { replaceUrl: true });
    }

    return true;
  }

  private onSessionUnlocked(): void {
    if (this.sessionResolveInFlight) {
      return;
    }

    this.sessionResolveInFlight = this.resolveUnlockedSession().finally(() => {
      this.sessionResolveInFlight = null;
    });
  }

  private async resolveUnlockedSession(): Promise<void> {
    if (isMandatoryLockSuspended()) {
      resumeMandatoryLock();
    }

    const userId = await getActiveAccountUserIdOrNull(this.accountService);
    if (!userId) {
      return;
    }

    const authStatus = await getAuthStatusOrNull(this.authService, userId);
    if (authStatus !== AuthenticationStatus.Unlocked) {
      return;
    }

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.lockService.syncDomLockClass();

    if (isMandatoryLockModeActive()) {
      this.lockService.requestAuthenticatorDialogReopen();
    }
  }
}
