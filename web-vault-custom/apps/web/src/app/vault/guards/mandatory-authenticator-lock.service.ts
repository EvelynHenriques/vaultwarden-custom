import { inject, Injectable } from "@angular/core";
import { NavigationStart, Router } from "@angular/router";
import { filter, Subject, switchMap, EMPTY, distinctUntilChanged } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { BroadcasterService } from "@bitwarden/common/platform/abstractions/broadcaster.service";
import { DialogRef, DialogService } from "@bitwarden/components";

import {
  activeAccountUserId$,
  getActiveAccountUserIdOrNull,
  getAuthStatusOrNull,
} from "./mandatory-authenticator-account.util";
import {
  ensureMandatoryAuthenticatorStatus,
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryLockExemptNavigation,
  isMandatoryLockModeActive,
  isMandatoryLockSuspended,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  resetMandatoryAuthenticatorSetupState,
  resumeMandatoryLock,
  shouldHideVaultUntilMandatoryStatusResolved,
  suspendMandatoryLock,
  shouldBlockMandatorySetupNavigation,
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
  private logoutInProgress = false;
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

    activeAccountUserId$(this.accountService)
      .pipe(
        switchMap((userId) => {
          if (!userId) {
            // Only clear mandatory lock state after an intentional logout — not transient null
            // during account switching.
            if (this.logoutInProgress) {
              this.prepareForLogout();
            }
            this.logoutInProgress = false;
            return EMPTY;
          }
          return this.authService.authStatusFor$(userId).pipe(distinctUntilChanged());
        }),
      )
      .subscribe((status) => {
        if (status === AuthenticationStatus.LoggedOut) {
          this.logoutInProgress = false;
          this.prepareForLogout();
          return;
        }
        // Fires on every transition to Unlocked (including first login after registration).
        if (status === AuthenticationStatus.Unlocked) {
          void this.onSessionUnlocked();
        }
      });
  }

  /** Re-evaluate mandatory 2FA when the vault becomes Unlocked (post-login). */
  private async onSessionUnlocked(): Promise<void> {
    if (this.logoutInProgress) {
      return;
    }

    // Clear suspension left over from a prior logout so the new session can enter setup lock.
    if (isMandatoryLockSuspended()) {
      resumeMandatoryLock();
    }

    await this.refreshLockState();
    if (!isMandatoryAuthenticatorSetupComplete()) {
      await this.enforceRoute(true);
    }
  }

  /** Suspend lock, close dialogs, and clear session lock state so logout can complete. */
  prepareForLogout(): void {
    this.logoutInProgress = true;
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
    if (isMandatoryLockSuspended()) {
      return false;
    }

    if (shouldHideVaultUntilMandatoryStatusResolved(url)) {
      return true;
    }

    if (!this.isLockModeActive()) {
      return false;
    }
    return shouldBlockMandatorySetupNavigation(url);
  }

  async refreshLockState(): Promise<boolean> {
    if (!(await this.isUnlockedAuthenticated())) {
      return false;
    }

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
    if (isMandatoryLockSuspended()) {
      return false;
    }

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.syncDomLockClass();

    if (isMandatoryAuthenticatorSetupComplete()) {
      return false;
    }

    const url = this.router.url;
    if (isMandatorySetupAllowedUrl(url) || isMandatoryLockExemptNavigation(url)) {
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
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[Mandatory2FA] enforcing redirect to setup", { from: url });
      }
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
      const lockWasActive = this.isLockModeActive();
      const allowCloseBeforeLogoutDialog = this.allowDialogClose;

      // Do not call prepareForLogout on dialog open — cancelling logout must not bypass mandatory
      // 2FA lock. Confirmed logout calls prepareForLogout() from AppComponent.logOut().
      if (isLogoutDialog && lockWasActive) {
        this.allowDialogClose = true;
      } else if (lockWasActive) {
        config = {
          ...config,
          disableClose: true,
          closeOnNavigation: false,
        };
      }
      const ref = originalOpen(componentOrTemplateRef, config);
      if (lockWasActive && !isLogoutDialog) {
        this.patchNonDismissibleClose(ref);
      }
      if (isLogoutDialog && lockWasActive) {
        ref.closed.subscribe(() => {
          if (this.logoutInProgress || !this.isLockModeActive()) {
            return;
          }
          this.allowDialogClose = allowCloseBeforeLogoutDialog;
          this.requestAuthenticatorDialogReopen();
          void this.enforceRoute(true);
        });
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
          cancelButtonText?: { key?: string };
          content?: { key?: string };
        }
      | undefined;

    const logoutKeys = new Set(["logOut", "logout", "logOutDesc", "logOutConfirmation"]);
    const fields = [data?.title?.key, data?.acceptButtonText?.key, data?.cancelButtonText?.key, data?.content?.key];

    return fields.some((key) => key != null && logoutKeys.has(key));
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
    if (!(await this.isUnlockedAuthenticated())) {
      return;
    }

    await this.refreshLockState();
    if (!isMandatoryAuthenticatorSetupComplete()) {
      await this.enforceRoute(true);
    }
  }

  private async handleNavigationStart(url: string): Promise<void> {
    if (isMandatoryLockSuspended() || isMandatoryLockExemptNavigation(url)) {
      return;
    }

    // Do not call prepareForLogout here — logout is handled by logOut(), broadcaster events,
    // and the activeAccount$ subscription. Navigation to "/" after login must not clear lock state.

    if (!(await this.isUnlockedAuthenticated())) {
      return;
    }

    // Resolve status before route activation so extension onboarding cannot win the race.
    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.syncDomLockClass();

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    if (isMandatorySetupAllowedUrl(url)) {
      if (!this.authenticatorDialogRegistered) {
        this.requestAuthenticatorDialogReopen();
      }
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

  private async isUnlockedAuthenticated(): Promise<boolean> {
    const userId = await getActiveAccountUserIdOrNull(this.accountService);
    if (!userId) {
      return false;
    }

    const status = await getAuthStatusOrNull(this.authService, userId);
    return status === AuthenticationStatus.Unlocked;
  }
}
