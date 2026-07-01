// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Component, DestroyRef, NgZone, OnDestroy, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Title } from "@angular/platform-browser";
import { NavigationEnd, Router } from "@angular/router";
import { Subject, filter, firstValueFrom, map, timeout } from "rxjs";

import { DeviceTrustToastService } from "@bitwarden/angular/auth/services/device-trust-toast.service.abstraction";
import { LockService } from "@bitwarden/auth/common";
import { DocumentLangSetter } from "@bitwarden/angular/platform/i18n";
import { InternalOrganizationServiceAbstraction } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { EventUploadService } from "@bitwarden/common/dirt/event-logs";
import { ProcessReloadServiceAbstraction } from "@bitwarden/common/key-management/abstractions/process-reload.service";
import { BroadcasterService } from "@bitwarden/common/platform/abstractions/broadcaster.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { StateService } from "@bitwarden/common/platform/abstractions/state.service";
import { ServerNotificationsService } from "@bitwarden/common/platform/server-notifications";
import { StateEventRunnerService } from "@bitwarden/common/platform/state";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { InternalFolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { DialogService, RouterFocusManagerService, ToastService } from "@bitwarden/components";
import { KeyService, BiometricStateService } from "@bitwarden/key-management";

import { getActiveAccountUserIdOrNull } from "./vault/guards/mandatory-authenticator-account.util";
import { MandatoryAuthenticatorEnforcementService } from "./vault/guards/mandatory-authenticator-enforcement.service";
import { MandatoryAuthenticatorLockService } from "./vault/guards/mandatory-authenticator-lock.service";
import {
  isMandatoryAuthFlowInProgress,
  isMandatory2faEnforcementEnabled,
  mandatory2faLog,
  mandatory2faNavLog,
  mandatory2faWarn,
  resetCurrentAuthFlowTotp,
} from "./vault/guards/mandatory-authenticator.policy";

const BroadcasterSubscriptionId = "AppComponent";
const IdleTimeout = 60000 * 10; // 10 minutes
const EBVAULT_DOCUMENT_TITLE = "EBcofre";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-root",
  templateUrl: "app.component.html",
  standalone: false,
})
export class AppComponent implements OnDestroy, OnInit {
  private lastActivity: Date = null;
  private idleTimer: number = null;
  private isIdle = false;
  private destroy$ = new Subject<void>();

  loading = false;

  constructor(
    private broadcasterService: BroadcasterService,
    private folderService: InternalFolderService,
    private cipherService: CipherService,
    private authService: AuthService,
    private router: Router,
    private toastService: ToastService,
    private platformUtilsService: PlatformUtilsService,
    private ngZone: NgZone,
    private keyService: KeyService,
    private serverNotificationsService: ServerNotificationsService,
    private stateService: StateService,
    private eventUploadService: EventUploadService,
    protected configService: ConfigService,
    private dialogService: DialogService,
    private biometricStateService: BiometricStateService,
    private stateEventRunnerService: StateEventRunnerService,
    private organizationService: InternalOrganizationServiceAbstraction,
    private accountService: AccountService,
    private processReloadService: ProcessReloadServiceAbstraction,
    private deviceTrustToastService: DeviceTrustToastService,
    private readonly destroy: DestroyRef,
    private readonly documentLangSetter: DocumentLangSetter,
    private readonly tokenService: TokenService,
    private readonly routerFocusManager: RouterFocusManagerService,
    private readonly mandatoryAuthenticatorEnforcementService: MandatoryAuthenticatorEnforcementService,
    private readonly mandatoryAuthenticatorLockService: MandatoryAuthenticatorLockService,
    private readonly titleService: Title,
    private readonly lockService: LockService,
  ) {
    this.deviceTrustToastService.setupListeners$.pipe(takeUntilDestroyed()).subscribe();

    const langSubscription = this.documentLangSetter.start();

    this.routerFocusManager.start$.pipe(takeUntilDestroyed()).subscribe();

    this.destroy.onDestroy(() => {
      langSubscription.unsubscribe();
    });

    this.mandatoryAuthenticatorEnforcementService.start();
    this.suppressMandatory2faSignalRRejections();
  }

  ngOnInit() {
    this.pinDocumentTitle();

    this.ngZone.runOutsideAngular(() => {
      window.onmousemove = () => this.recordActivity();
      window.onmousedown = () => this.recordActivity();
      window.ontouchstart = () => this.recordActivity();
      window.onclick = () => this.recordActivity();
      window.onscroll = () => this.recordActivity();
      window.onkeypress = () => this.recordActivity();
    });

    /// ############ DEPRECATED ############
    /// Please do not use the AppComponent to send events between services.
    ///
    /// Services that depends on other services, should do so through Dependency Injection
    /// and subscribe to events through that service observable.
    ///
    this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
      // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.ngZone.run(async () => {
        switch (message.command) {
          case "authBlocked":
            mandatory2faLog("authBlocked received", message);
            if (await this.mandatoryAuthenticatorEnforcementService.handleAuthFailure(message)) {
              mandatory2faLog("authBlocked handled as mandatory setup; no login redirect");
              break;
            }
            mandatory2faWarn("authBlocked; redirecting to login");
            mandatory2faNavLog("AppComponent/authBlocked", {
              currentUrl: this.router.url,
              requestedUrl: "/",
              finalUrl: "/",
            });
            // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.router.navigate(["/"]);
            break;
          case "logout":
            // Only invalidAccessToken from mandatory-setup race — never suppress other logout reasons.
            if (
              message?.logoutReason === "invalidAccessToken" &&
              (await this.mandatoryAuthenticatorEnforcementService.handleAuthFailure(message))
            ) {
              mandatory2faWarn("logout (invalidAccessToken) suppressed — mandatory 2FA setup active");
              break;
            }
            // note: the message.logoutReason isn't consumed anymore because of the process reload clearing any toasts.
            await this.logOut(message.redirect);
            break;
          case "lockVault": {
            if (!isMandatory2faEnforcementEnabled()) {
              const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
              await this.lockService.lock(userId);
              break;
            }
            if (isMandatoryAuthFlowInProgress()) {
              mandatory2faLog("lockVault ignored during active login/2FA flow", message);
              break;
            }
            resetCurrentAuthFlowTotp("lockVault broadcaster event");
            mandatory2faLog("lockVault received; EBcofre requires full re-login before vault access");
            await this.logOut(true);
            break;
          }
          case "locked":
            if (!isMandatory2faEnforcementEnabled()) {
              await this.router.navigate(["/"]);
              await this.processReloadService.startProcessReload();
              break;
            }
            if (isMandatoryAuthFlowInProgress()) {
              mandatory2faLog("locked ignored during active login/2FA flow", message);
              break;
            }
            resetCurrentAuthFlowTotp("locked broadcaster event");
            mandatory2faLog("locked received", message);
            if (await this.mandatoryAuthenticatorEnforcementService.handleAuthFailure(message)) {
              mandatory2faLog("locked handled as mandatory setup; no full re-login");
              break;
            }
            mandatory2faWarn("locked; EBcofre requires full re-login before vault access");
            await this.logOut(true);
            break;
          case "lockedUrl":
            break;
          case "syncStarted":
            break;
          case "syncCompleted":
            if (message.successfully) {
              await this.configService.ensureConfigFetched();
            }
            break;
          case "upgradeOrganization": {
            const upgradeConfirmed = await this.dialogService.openSimpleDialog({
              title: { key: "upgradeOrganization" },
              content: { key: "upgradeOrganizationDesc" },
              acceptButtonText: { key: "upgradeOrganization" },
              type: "info",
            });
            if (upgradeConfirmed) {
              mandatory2faNavLog("AppComponent/upgradeOrganization", {
                currentUrl: this.router.url,
                requestedUrl: "/vault",
                finalUrl: "/vault",
              });
              await this.router.navigate(["vault"], { replaceUrl: true });
            }
            break;
          }
          case "emailVerificationRequired":
            await this.dialogService.openSimpleDialog({
              title: { key: "emailVerificationRequired" },
              content: { key: "emailVerificationRequiredDesc" },
              acceptButtonText: { key: "ok" },
              type: "info",
            });
            break;
          case "showToast":
            this.toastService._showToast(message);
            break;
          case "convertAccountToKeyConnector":
            mandatory2faNavLog("AppComponent/convertAccountToKeyConnector", {
              currentUrl: this.router.url,
              requestedUrl: "/remove-password",
              finalUrl: "/remove-password",
            });
            // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.router.navigate(["/remove-password"]);
            break;
          case "syncOrganizationStatusChanged": {
            const { organizationId, enabled } = message;
            const userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
            const organizations = await firstValueFrom(
              this.organizationService.organizations$(userId),
            );
            const organization = organizations.find((org) => org.id === organizationId);

            if (organization) {
              const updatedOrganization = {
                ...organization,
                enabled: enabled,
              };
              await this.organizationService.upsert(updatedOrganization, userId);
            }
            break;
          }
          case "syncOrganizationCollectionSettingChanged": {
            const { organizationId, limitCollectionCreation, limitCollectionDeletion } = message;
            const userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
            const organizations = await firstValueFrom(
              this.organizationService.organizations$(userId),
            );
            const organization = organizations.find((org) => org.id === organizationId);

            if (organization) {
              await this.organizationService.upsert(
                {
                  ...organization,
                  limitCollectionCreation: limitCollectionCreation,
                  limitCollectionDeletion: limitCollectionDeletion,
                },
                userId,
              );
            }
            break;
          }
          default:
            break;
        }
      });
    });
  }

  ngOnDestroy() {
    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
    this.destroy$.next();
    this.destroy$.complete();
  }

  private pinDocumentTitle(): void {
    const apply = () => {
      if (document.title !== EBVAULT_DOCUMENT_TITLE) {
        this.titleService.setTitle(EBVAULT_DOCUMENT_TITLE);
      }
    };

    apply();

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe(() => apply());

    const titleElement = document.querySelector("title");
    if (titleElement) {
      new MutationObserver(() => apply()).observe(titleElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  private async logOut(redirect = true) {
    this.mandatoryAuthenticatorLockService.prepareForLogout();

    // Ensure the loading state is applied before proceeding to avoid a flash
    // of the login screen before the process reload fires.
    this.ngZone.run(() => {
      this.loading = true;
      document.body.classList.add("layout_frontend");
    });

    // Note: we don't display a toast logout reason anymore as the process reload
    // will prevent any toasts from being displayed long enough to be read

    await this.eventUploadService.uploadEvents();
    const userId = await getActiveAccountUserIdOrNull(this.accountService);

    if (userId == null) {
      await this.accountService.switchAccount(null);
      if (redirect) {
        mandatory2faNavLog("AppComponent/logOut/noUser", {
          currentUrl: this.router.url,
          requestedUrl: "/login",
          finalUrl: "/login",
        });
        await this.router.navigate(["/login"], {
          replaceUrl: true,
        });
      }
      await this.processReloadService.startProcessReload();
      return;
    }

    const logoutPromise = firstValueFrom(
      this.authService.authStatusFor$(userId).pipe(
        filter((authenticationStatus) => authenticationStatus === AuthenticationStatus.LoggedOut),
        timeout({
          first: 5_000,
          with: () => {
            throw new Error("The logout process did not complete in a reasonable amount of time.");
          },
        }),
      ),
    );

    await Promise.all([
      this.keyService.clearKeys(userId),
      this.cipherService.clear(userId),
      this.folderService.clear(userId),
      this.biometricStateService.logout(userId),
    ]);

    await this.stateEventRunnerService.handleEvent("logout", userId);

    this.authService.logOut(async () => {
      await this.stateService.clean({ userId: userId });
      await this.tokenService.clearTokens(userId);
      await this.accountService.clean(userId);
      await this.accountService.switchAccount(null);

      try {
        await logoutPromise;
      } catch {
        // The account/session is already cleared; continue to the login screen.
      }

      if (redirect) {
        mandatory2faNavLog("AppComponent/logOut", {
          currentUrl: this.router.url,
          requestedUrl: "/login",
          finalUrl: "/login",
        });
        await this.router.navigate(["/login"], {
          replaceUrl: true,
        });
      }

      await this.processReloadService.startProcessReload();

      // Normally we would need to reset the loading state to false or remove the layout_frontend
      // class from the body here, but the process reload completely reloads the app so
      // it handles it.
    }, userId);
  }

  private async recordActivity() {
    const activeUserId = await firstValueFrom(
      this.accountService.activeAccount$.pipe(map((a) => a?.id)),
    );
    const now = new Date();
    if (this.lastActivity != null && now.getTime() - this.lastActivity.getTime() < 250) {
      return;
    }

    this.lastActivity = now;
    await this.accountService.setAccountActivity(activeUserId, now);
    // Idle states
    if (this.isIdle) {
      this.isIdle = false;
      this.idleStateChanged();
    }
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.idleTimer = window.setTimeout(() => {
      if (!this.isIdle) {
        this.isIdle = true;
        this.idleStateChanged();
      }
    }, IdleTimeout);
  }

  private idleStateChanged() {
    if (this.isIdle) {
      try {
        this.serverNotificationsService.disconnectFromInactivity();
      } catch (error) {
        mandatory2faWarn("server notification pause failed during idle transition", error);
      }
    } else {
      mandatory2faWarn("server notifications resume skipped by EBcofre mandatory 2FA policy");
    }
  }

  private suppressMandatory2faSignalRRejections(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.addEventListener("unhandledrejection", (event: Event) => {
      const rejectionEvent = event as Event & { reason?: unknown };
      const reason = rejectionEvent.reason;
      const reasonText =
        reason instanceof Error
          ? reason.message
          : typeof reason === "object" && reason != null && "message" in reason
            ? String((reason as { message?: unknown }).message ?? reason)
            : String(reason ?? "");
      if (!reasonText.includes("WebSocket failed to connect")) {
        return;
      }

      mandatory2faWarn("SignalR failed but EBcofre continues without server notifications", reason);
      event.preventDefault();
    });
  }
}
