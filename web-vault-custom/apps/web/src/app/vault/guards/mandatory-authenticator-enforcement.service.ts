import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { EMPTY, distinctUntilChanged, switchMap } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import type { FetchMiddleware } from "@bitwarden/common/platform/misc/fetch-middleware";

import {
  activeAccountUserId$,
  getActiveAccountUserIdOrNull,
  getAuthStatusOrNull,
} from "./mandatory-authenticator-account.util";
import { registerMandatoryAuthenticatorApiMiddleware } from "./mandatory-authenticator-api.middleware";
import { MandatoryAuthenticatorLockService } from "./mandatory-authenticator-lock.service";
import {
  confirmMandatoryAuthenticatorRequiredFromApi,
  ensureMandatoryAuthenticatorStatus,
  enterPostLoginVerificationState,
  isMandatoryAuthenticatorSetupApiError,
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryAuthenticatorSetupRequired,
  isMandatoryLockExemptNavigation,
  isMandatoryLockModeActive,
  isMandatoryLockSuspended,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  normalizeMandatorySetupPath,
  resumeMandatoryLock,
  shouldHideAuthenticatedContent,
} from "./mandatory-authenticator.policy";

type ApiServiceWithMiddleware = ApiService & {
  addMiddleware?: (middleware: FetchMiddleware) => void;
};

/**
 * Central mandatory-2FA orchestrator.
 *
 * Order after login:
 * 1. Register API middleware (block vault endpoints locally).
 * 2. Enter post-login verification state on unlock.
 * 3. Resolve Authenticator 2FA status via allowed API only.
 * 4. Redirect to setup or release restriction.
 */
@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorEnforcementService {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly twoFactorService = inject(TwoFactorService);
  private readonly lockService = inject(MandatoryAuthenticatorLockService);
  private readonly apiService = inject(ApiService) as ApiServiceWithMiddleware;

  private started = false;
  private sessionResolveInFlight: Promise<void> | null = null;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    if (typeof this.apiService.addMiddleware === "function") {
      registerMandatoryAuthenticatorApiMiddleware((middleware) =>
        this.apiService.addMiddleware!(middleware),
      );
    }

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

  /**
   * Await mandatory 2FA resolution before vault sync or layout initialization.
   * Returns true when Authenticator 2FA is configured for this session.
   */
  async waitForMandatoryGate(): Promise<boolean> {
    if (this.sessionResolveInFlight) {
      await this.sessionResolveInFlight;
    } else {
      await this.resolveUnlockedSession();
    }

    return isMandatoryAuthenticatorSetupComplete();
  }

  shouldHideAuthenticatedContent(url: string): boolean {
    return shouldHideAuthenticatedContent(url);
  }

  /**
   * Keeps the session alive when a vault API returns the mandatory-2FA gate message.
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

    await this.navigateToMandatorySetupIfNeeded();
    return true;
  }

  private onSessionUnlocked(): void {
    enterPostLoginVerificationState();

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

    enterPostLoginVerificationState();

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.lockService.syncDomLockClass();

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    if (!isMandatoryLockModeActive()) {
      return;
    }

    await this.navigateToMandatorySetupIfNeeded();
    this.lockService.requestAuthenticatorDialogReopen();
  }

  private async navigateToMandatorySetupIfNeeded(): Promise<void> {
    const currentPath = normalizeMandatorySetupPath(this.router.url);
    if (isMandatorySetupAllowedUrl(currentPath) || isMandatoryLockExemptNavigation(currentPath)) {
      return;
    }

    await this.router.navigate([MANDATORY_TWO_FACTOR_SETUP_URL], { replaceUrl: true });
  }
}
