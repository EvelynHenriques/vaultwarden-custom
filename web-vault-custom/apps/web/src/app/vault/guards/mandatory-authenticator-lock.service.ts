import { inject, Injectable } from "@angular/core";
import { ReplaySubject } from "rxjs";

import { BroadcasterService } from "@bitwarden/common/platform/abstractions/broadcaster.service";
import { DialogRef, DialogService } from "@bitwarden/components";

import {
  isMandatoryLockModeActive,
  isMandatoryLockSuspended,
  resetMandatoryAuthenticatorSetupState,
  suspendMandatoryLock,
} from "./mandatory-authenticator.policy";

type MandatoryDialogKind = "verify" | "authenticator";

/**
 * UI-only mandatory 2FA lock: non-dismissible dialogs, DOM state, and logout cleanup.
 * Navigation is handled exclusively by route guards.
 */
@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorLockService {
  private readonly dialogService = inject(DialogService);
  private readonly broadcasterService = inject(BroadcasterService);

  private static readonly BROADCASTER_ID = "MandatoryAuthenticatorLockService";

  private uiInitialized = false;
  private logoutInProgress = false;
  private dialogServicePatched = false;
  private allowDialogClose = false;
  private escapeListenerAttached = false;

  private readonly mandatoryDialogRefs = new Set<DialogRef>();
  private authenticatorDialogRegistered = false;

  private reopenAuthenticatorDialogSubject = new ReplaySubject<void>(1);
  reopenAuthenticatorDialog$ = this.reopenAuthenticatorDialogSubject.asObservable();

  initializeUi(): void {
    if (this.uiInitialized) {
      return;
    }
    this.uiInitialized = true;

    this.patchDialogService();
    this.attachEscapeBlocker();
    this.attachLogoutListener();
  }

  prepareForLogout(): void {
    this.logoutInProgress = true;
    suspendMandatoryLock();
    resetMandatoryAuthenticatorSetupState();
    this.allowDialogClose = true;
    this.authenticatorDialogRegistered = false;
    this.mandatoryDialogRefs.clear();
    document.body.classList.remove("vw-mandatory-2fa-lock-mode");
    this.dialogService.closeAll();
    this.resetReopenAuthenticatorDialogSubject();
  }

  isLockModeActive(): boolean {
    return isMandatoryLockModeActive();
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

    if (this.authenticatorDialogRegistered) {
      return;
    }

    this.reopenAuthenticatorDialogSubject.next();
  }

  private resetReopenAuthenticatorDialogSubject(): void {
    this.reopenAuthenticatorDialogSubject.complete();
    this.reopenAuthenticatorDialogSubject = new ReplaySubject<void>(1);
    this.reopenAuthenticatorDialog$ = this.reopenAuthenticatorDialogSubject.asObservable();
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

      if (isLogoutDialog && lockWasActive) {
        this.allowDialogClose = true;
      } else if (lockWasActive) {
        config = {
          ...asDialogConfigObject(config),
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
    const fields = [
      data?.title?.key,
      data?.acceptButtonText?.key,
      data?.cancelButtonText?.key,
      data?.content?.key,
    ];

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
}

function asDialogConfigObject(config: unknown): Record<string, unknown> {
  if (config == null || typeof config !== "object") {
    return {};
  }

  return config as Record<string, unknown>;
}
