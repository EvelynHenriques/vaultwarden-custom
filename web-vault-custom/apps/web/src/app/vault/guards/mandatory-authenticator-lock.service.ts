import { inject, Injectable } from "@angular/core";
import { NavigationStart, Router } from "@angular/router";
import { filter, firstValueFrom, Subject } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { BroadcasterService } from "@bitwarden/common/platform/abstractions/broadcaster.service";
import { DialogRef, DialogService } from "@bitwarden/components";

import {
  ensureMandatoryAuthenticatorStatus,
  isMandatoryLockExemptNavigation,
  isMandatoryLockModeActive,
  isMandatorySetupAllowedUrl,
  isLogoutNavigationTarget,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  resetMandatoryAuthenticatorSetupState,
  resumeMandatoryLock,
  shouldBlockMandatorySetupNavigation,
  suspendMandatoryLock,
} from "./mandatory-authenticator.policy";

type MandatoryDialogKind = "verify" | "authenticator";

/**
 * Global mandatory-2FA lock mode. While active, the authenticated web vault may only
 * remain on the whitelisted 2FA setup route with non-dismissible setup dialogs.
 */
@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorLockService {
  private readonly router = inject(Router);
  private readonly twoFactorService = inject(TwoFactorService);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly dialogService = inject(DialogService);
  private readonly broadcasterService = inject(BroadcasterService);

  private static readonly BROADCASTER_ID = "MandatoryAuthenticatorLockService";

  private started = false;
  private redirectInFlight = false;
  private dialogServicePatched = false;
  private allowDialogClose = false;
  private escapeListenerAttached = false;

  private readonly mandatoryDialogRefs = new Set<DialogRef>();
  private authenticatorDialogRegistered = false;

  /** Emitted when the authenticator setup dialog must be (re)opened. */
  readonly reopenAuthenticatorDialog$ = new Subject<void>();

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.patchDialogService();
    this.attachEscapeBlocker();
    this.attachLogoutListener();

    void this.bootstrap();

    this.router.events
      .pipe(filter((event) => event instanceof NavigationStart))
      .subscribe((event) => {
        void this.handleNavigationStart(event.url);
      });

    this.accountService.activeAccount$.pipe(getUserId).subscribe((userId) => {
      if (!userId) {
        this.prepareForLogout();
        return;
      }
      void firstValueFrom(this.authService.authStatusFor$(userId)).then((status) => {
        if (status === AuthenticationStatus.LoggedOut) {
          this.prepareForLogout();
          return;
        }
        if (
          status === AuthenticationStatus.Unlocked ||
          status === AuthenticationStatus.Locked
        ) {
          resumeMandatoryLock();
        }
      });
    });
  }

  /** Suspend lock, close dialogs, and clear session lock state so logout can complete. */
  prepareForLogout(): void {
    suspendMandatoryLock();
    resetMandatoryAuthenticatorSetupState();
    this.allowDialogClose = true;
    this.authenticatorDialogRegistered = false;
    this.mandatoryDialogRefs.clear();
    document.body.classList.remove("vw-mandatory-2fa-lock-mode");
    this.dialogService.closeAll();
  }

  isLockModeActive(): boolean {
    return isMandatoryLockModeActive();
  }

  shouldAllowUrl(url: string): boolean {
    if (!this.isLockModeActive()) {
      return true;
    }
    return isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url);
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
      this.allowDialogClose = false;
    } else {
      document.body.classList.remove("vw-mandatory-2fa-lock-mode");
      this.mandatoryDialogRefs.clear();
      this.authenticatorDialogRegistered = false;
      this.allowDialogClose = true;
    }
  }

  allowMandatoryDialogClose(): void {
    this.allowDialogClose = true;
  }

  /** Close a mandatory dialog after a successful step without unlocking the app. */
  forceCloseMandatoryDialog(ref: DialogRef, result?: unknown): void {
    const wasAllowed = this.allowDialogClose;
    this.allowDialogClose = true;
    ref.disableClose = false;

    const cdkRef = (ref as { cdkDialogRefBase?: DialogRef }).cdkDialogRefBase;
    if (cdkRef) {
      cdkRef.disableClose = false;
    }

    ref.close(result);

    if (!wasAllowed && this.isLockModeActive()) {
      this.allowDialogClose = false;
    }
  }

  registerMandatoryDialog(ref: DialogRef, kind: MandatoryDialogKind): void {
    if (!this.isLockModeActive()) {
      return;
    }

    this.mandatoryDialogRefs.add(ref);
    ref.disableClose = true;
    this.patchNonDismissibleClose(ref);

    if (kind === "authenticator") {
      this.authenticatorDialogRegistered = true;
    }

    ref.closed.subscribe(() => {
      this.mandatoryDialogRefs.delete(ref);
      if (kind === "authenticator") {
        this.authenticatorDialogRegistered = false;
      }

      if (this.isLockModeActive() && !this.allowDialogClose) {
        this.requestAuthenticatorDialogReopen();
        void this.enforceRoute(true);
      }
    });
  }

  /** @deprecated Use registerMandatoryDialog */
  registerAuthenticatorDialog(ref: DialogRef): void {
    this.registerMandatoryDialog(ref, "authenticator");
  }

  requestAuthenticatorDialogReopen(): void {
    if (!this.isLockModeActive() || this.allowDialogClose) {
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
      if (!this.authenticatorDialogRegistered) {
        this.requestAuthenticatorDialogReopen();
      }
      return false;
    }

    if (this.redirectInFlight) {
      return true;
    }

    this.redirectInFlight = true;
    try {
      await this.router.navigateByUrl(MANDATORY_TWO_FACTOR_SETUP_URL, { replaceUrl });
      if (!this.authenticatorDialogRegistered) {
        this.requestAuthenticatorDialogReopen();
      }
      return true;
    } finally {
      this.redirectInFlight = false;
    }
  }

  private patchDialogService(): void {
    if (this.dialogServicePatched) {
      return;
    }
    this.dialogServicePatched = true;

    const dialogService = this.dialogService as DialogService & {
      open: DialogService["open"];
      closeAll: DialogService["closeAll"];
    };

    const originalOpen = dialogService.open.bind(dialogService);
    dialogService.open = ((componentOrTemplateRef, config) => {
      const isLogoutDialog = this.isLogoutDialogConfig(config);
      if (this.isLockModeActive() && !isLogoutDialog) {
        config = {
          ...config,
          disableClose: true,
          closeOnNavigation: false,
        };
      }
      const ref = originalOpen(componentOrTemplateRef, config);
      if (this.isLockModeActive() && !isLogoutDialog) {
        this.patchNonDismissibleClose(ref);
      }
      return ref;
    }) as DialogService["open"];

    const originalCloseAll = dialogService.closeAll.bind(dialogService);
    dialogService.closeAll = () => {
      if (this.isLockModeActive() && !this.allowDialogClose) {
        return;
      }
      originalCloseAll();
    };
  }

  private isLogoutDialogConfig(config: unknown): boolean {
    const data = (config as { data?: unknown } | undefined)?.data as
      | {
          title?: { key?: string };
          acceptButtonText?: { key?: string };
        }
      | undefined;

    return data?.title?.key === "logOut" || data?.acceptButtonText?.key === "logOut";
  }

  private attachLogoutListener(): void {
    this.broadcasterService.subscribe(
      MandatoryAuthenticatorLockService.BROADCASTER_ID,
      (message: { command?: string }) => {
        if (message?.command === "logout" || message?.command === "loggedOut") {
          this.prepareForLogout();
        }
      },
    );
  }

  private attachEscapeBlocker(): void {
    if (this.escapeListenerAttached || typeof document === "undefined") {
      return;
    }
    this.escapeListenerAttached = true;

    document.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key !== "Escape") {
          return;
        }
        if (!this.isLockModeActive() || this.allowDialogClose) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }

  private async bootstrap(): Promise<void> {
    if (!(await this.isAuthenticated())) {
      this.prepareForLogout();
      return;
    }

    resumeMandatoryLock();
    await this.refreshLockState();
    if (this.isLockModeActive()) {
      await this.enforceRoute(true);
    }
  }

  private async handleNavigationStart(url: string): Promise<void> {
    if (isLogoutNavigationTarget(url)) {
      if (await this.isAuthenticated()) {
        this.prepareForLogout();
      } else if (this.isLockModeActive()) {
        this.prepareForLogout();
      }
      return;
    }

    if (!(await this.isAuthenticated())) {
      return;
    }

    if (!this.isLockModeActive()) {
      return;
    }

    if (!shouldBlockMandatorySetupNavigation(url)) {
      if (!this.authenticatorDialogRegistered) {
        this.requestAuthenticatorDialogReopen();
      }
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
    ref.disableClose = true;

    const originalClose = ref.close.bind(ref);
    ref.close = (result?: unknown, options?: unknown) => {
      if (this.isLockModeActive() && !this.allowDialogClose) {
        this.requestAuthenticatorDialogReopen();
        return;
      }
      originalClose(result, options);
    };

    const cdkRef = (ref as { cdkDialogRefBase?: DialogRef }).cdkDialogRefBase;
    if (cdkRef) {
      cdkRef.disableClose = true;
      const originalCdkClose = cdkRef.close.bind(cdkRef);
      cdkRef.close = (result?: unknown, options?: unknown) => {
        if (this.isLockModeActive() && !this.allowDialogClose) {
          this.requestAuthenticatorDialogReopen();
          return;
        }
        originalCdkClose(result, options);
      };
    }
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
