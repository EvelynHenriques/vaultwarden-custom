import { inject, Injectable } from "@angular/core";
import { NavigationStart, Router } from "@angular/router";
import { filter, firstValueFrom, Subject } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { DialogRef } from "@bitwarden/components";

import {
  ensureMandatoryAuthenticatorStatus,
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryLockModeActive,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  resetMandatoryAuthenticatorSetupState,
  shouldBlockMandatorySetupNavigation,
} from "./mandatory-authenticator.policy";

/**
 * Global mandatory-2FA lock mode. While active, the authenticated web vault may only
 * remain on the whitelisted 2FA setup route with a non-dismissible setup dialog.
 */
@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorLockService {
  private readonly router = inject(Router);
  private readonly twoFactorService = inject(TwoFactorService);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);

  private started = false;
  private redirectInFlight = false;
  private authenticatorDialogRef: DialogRef | null = null;

  /** Emitted when the authenticator setup dialog must be (re)opened. */
  readonly reopenAuthenticatorDialog$ = new Subject<void>();

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    void this.bootstrap();

    this.router.events
      .pipe(filter((event) => event instanceof NavigationStart))
      .subscribe((event) => {
        void this.handleNavigationStart(event.url);
      });

    this.accountService.activeAccount$.pipe(getUserId).subscribe((userId) => {
      if (!userId) {
        resetMandatoryAuthenticatorSetupState();
        this.syncDomLockClass();
        return;
      }
      void firstValueFrom(this.authService.authStatusFor$(userId)).then((status) => {
        if (status === AuthenticationStatus.LoggedOut) {
          resetMandatoryAuthenticatorSetupState();
          this.syncDomLockClass();
        }
      });
    });
  }

  /** True while Authenticator 2FA step login is still required for this session. */
  isLockModeActive(): boolean {
    return isMandatoryLockModeActive();
  }

  shouldAllowUrl(url: string): boolean {
    if (!this.isLockModeActive()) {
      return true;
    }
    return isMandatorySetupAllowedUrl(url);
  }

  shouldHideAuthenticatedContent(url: string): boolean {
    if (!this.isLockModeActive()) {
      return false;
    }
    return shouldBlockMandatorySetupNavigation(url);
  }

  async refreshLockState(): Promise<boolean> {
    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.syncDomLockClass();
    return this.isLockModeActive();
  }

  syncDomLockClass(): void {
    if (this.isLockModeActive()) {
      document.body.classList.add("vw-mandatory-2fa-lock-mode");
    } else {
      document.body.classList.remove("vw-mandatory-2fa-lock-mode");
      this.authenticatorDialogRef = null;
    }
  }

  registerAuthenticatorDialog(ref: DialogRef): void {
    this.authenticatorDialogRef = ref;

    if (this.isLockModeActive()) {
      ref.disableClose = true;
      this.patchNonDismissibleClose(ref);
    }

    ref.closed.subscribe(() => {
      if (this.authenticatorDialogRef === ref) {
        this.authenticatorDialogRef = null;
      }
      if (this.isLockModeActive()) {
        this.requestAuthenticatorDialogReopen();
        void this.enforceRoute();
      }
    });
  }

  requestAuthenticatorDialogReopen(): void {
    if (!this.isLockModeActive()) {
      return;
    }
    this.reopenAuthenticatorDialog$.next();
  }

  async enforceRoute(replaceUrl = true): Promise<boolean> {
    if (!this.isLockModeActive()) {
      return false;
    }

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.syncDomLockClass();

    if (!this.isLockModeActive()) {
      return false;
    }

    const url = this.router.url;
    if (!shouldBlockMandatorySetupNavigation(url)) {
      return false;
    }

    if (this.redirectInFlight) {
      return true;
    }

    this.redirectInFlight = true;
    try {
      await this.router.navigateByUrl(MANDATORY_TWO_FACTOR_SETUP_URL, { replaceUrl });
      return true;
    } finally {
      this.redirectInFlight = false;
    }
  }

  private async bootstrap(): Promise<void> {
    if (!(await this.isAuthenticated())) {
      return;
    }

    await this.refreshLockState();
    if (this.isLockModeActive()) {
      await this.enforceRoute(true);
    }
  }

  private async handleNavigationStart(url: string): Promise<void> {
    if (!(await this.isAuthenticated())) {
      return;
    }

    if (!this.isLockModeActive()) {
      return;
    }

    if (!shouldBlockMandatorySetupNavigation(url)) {
      return;
    }

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.syncDomLockClass();

    if (!this.isLockModeActive()) {
      return;
    }

    void this.enforceRoute(true);
  }

  private patchNonDismissibleClose(ref: DialogRef): void {
    const originalClose = ref.close.bind(ref);
    ref.close = (result?: unknown) => {
      if (this.isLockModeActive()) {
        return;
      }
      originalClose(result);
    };
  }

  private async isAuthenticated(): Promise<boolean> {
    const userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    if (!userId) {
      return false;
    }

    const status = await firstValueFrom(this.authService.authStatusFor$(userId));
    return status === AuthenticationStatus.Unlocked || status === AuthenticationStatus.Locked;
  }
}
