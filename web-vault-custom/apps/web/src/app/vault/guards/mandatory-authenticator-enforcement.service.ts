import { inject, Injectable } from "@angular/core";
import { NavigationStart, Router } from "@angular/router";
import { distinctUntilChanged, EMPTY, switchMap } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { ServerNotificationsService } from "@bitwarden/common/platform/server-notifications";
import { UserId } from "@bitwarden/common/types/guid";

import {
  getActiveAccountUserIdOrNull,
  getAuthStatusOrNull,
} from "./mandatory-authenticator-account.util";
import { registerMandatoryAuthenticatorApiMiddleware } from "./mandatory-authenticator-api.middleware";
import { MandatoryAuthenticatorLockService } from "./mandatory-authenticator-lock.service";
import {
  confirmMandatoryAuthenticatorRequiredFromApi,
  enterPostLoginVerificationState,
  failSafeUnresolvedGate,
  getMandatoryGatePhase,
  isMandatoryLockExemptNavigation,
  isMandatoryLockSuspended,
  isMandatorySetupAllowedUrl,
  isPreLoginAuthenticationRoute,
  isVaultAccessAllowedByGate,
  mandatory2faLog,
  mandatory2faWarn,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  normalizeMandatorySetupPath,
  resetMandatoryAuthenticatorSetupState,
  resolveMandatoryAuthenticatorGate,
  resumeMandatoryLock,
  shouldHideAuthenticatedContent,
  shouldInterceptAuthFailureAsMandatorySetup,
} from "./mandatory-authenticator.policy";

/** Safety fallback only — normal flow is event/state-driven. */
const ACCOUNT_WAIT_MS = 15_000;
/** Safety fallback only — normal flow awaits gate resolution promise. */
const GATE_WAIT_MS = 20_000;

type ApiServiceWithMiddleware = ApiService & {
  addMiddleware?: (middleware: unknown) => void;
};

@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorEnforcementService {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly twoFactorService = inject(TwoFactorService);
  private readonly lockService = inject(MandatoryAuthenticatorLockService);
  private readonly apiService = inject(ApiService) as ApiServiceWithMiddleware;
  private readonly serverNotificationsService = inject(ServerNotificationsService);

  private started = false;
  private gateResolvePromise: Promise<void> | null = null;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    if (typeof this.apiService.addMiddleware === "function") {
      registerMandatoryAuthenticatorApiMiddleware((middleware) =>
        this.apiService.addMiddleware!(middleware),
      );
      mandatory2faLog("app startup / middleware registered");
    } else {
      mandatory2faLog("app startup / middleware NOT available on ApiService");
    }

    this.lockService.initializeUi();
    this.attachPreLoginRouteListener();

    this.accountService.activeAccount$
      .pipe(
        switchMap((account) => {
          if (!account?.id) {
            return EMPTY;
          }
          return this.authService.authStatusFor$(account.id).pipe(distinctUntilChanged());
        }),
      )
      .subscribe((status) => {
        if (status === AuthenticationStatus.LoggedOut) {
          this.pauseServerNotifications();
          this.lockService.prepareForLogout();
          return;
        }

        if (status === AuthenticationStatus.Unlocked) {
          mandatory2faLog("login or unlock success");
          enterPostLoginVerificationState();
          this.pauseServerNotifications();
          this.scheduleGateResolution();
        }
      });

    void this.bootstrapExistingSession();
  }

  /** Clear stale mandatory gate state when returning to pre-unlock login routes. */
  private attachPreLoginRouteListener(): void {
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationStart)) {
        return;
      }

      if (!isPreLoginAuthenticationRoute(event.url)) {
        return;
      }

      const phase = getMandatoryGatePhase();
      if (phase === "pending" || phase === "blocked") {
        mandatory2faLog("reset gate for pre-login route", {
          path: normalizeMandatorySetupPath(event.url),
        });
        resetMandatoryAuthenticatorSetupState();
      }
    });
  }

  private async bootstrapExistingSession(): Promise<void> {
    const userId = await getActiveAccountUserIdOrNull(this.accountService);
    if (!userId) {
      return;
    }

    const status = await getAuthStatusOrNull(this.authService, userId);
    if (status === AuthenticationStatus.Unlocked) {
      mandatory2faLog("login or unlock success (existing session)");
      enterPostLoginVerificationState();
      this.pauseServerNotifications();
      this.scheduleGateResolution();
    }
  }

  shouldHideAuthenticatedContent(url: string): boolean {
    return shouldHideAuthenticatedContent(url);
  }

  isMandatorySetupPending(): boolean {
    const phase = getMandatoryGatePhase();
    return phase === "pending" || phase === "blocked";
  }

  /**
   * Await gate resolution. Event-driven via gate promise; timeout is fail-safe only.
   * Returns true only when Authenticator 2FA is confirmed configured.
   */
  async waitForMandatoryGate(): Promise<boolean> {
    try {
      await Promise.race([
        this.ensureGateResolved(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("mandatory gate timeout")), GATE_WAIT_MS),
        ),
      ]);
    } catch (error) {
      mandatory2faLog("error while resolving state =", String(error));
      this.applyFailSafeRestrictedState();
    }

    return isVaultAccessAllowedByGate();
  }

  /**
   * Handle authBlocked/locked/mandatory invalidAccessToken without logging out.
   * Returns false for generic auth failures outside mandatory gate scope.
   */
  async handleAuthFailure(signal?: Record<string, unknown>): Promise<boolean> {
    if (isMandatoryLockSuspended()) {
      return false;
    }

    const phase = getMandatoryGatePhase();
    if (!shouldInterceptAuthFailureAsMandatorySetup(phase, signal)) {
      mandatory2faLog("auth failure not treated as mandatory setup", { phase, signal });
      return false;
    }

    mandatory2faLog("mandatory 2FA auth failure intercepted — not treating as logout", {
      phase,
      signal,
    });

    const userId = await this.waitForActiveUnlockedAccount();
    if (!userId) {
      mandatory2faWarn("mandatory auth failure but no unlocked account yet — applying fail-safe");
      confirmMandatoryAuthenticatorRequiredFromApi();
      failSafeUnresolvedGate();
      await this.openMandatorySetupAfterGate();
      return true;
    }

    confirmMandatoryAuthenticatorRequiredFromApi();
    await this.ensureGateResolved();
    await this.openMandatorySetupAfterGate();
    return true;
  }

  async openMandatorySetupAfterGate(): Promise<void> {
    await this.navigateToMandatorySetupIfNeeded();
    await this.waitForSetupRouteActivation();
    mandatory2faLog("opening mandatory setup dialog");
    this.lockService.requestAuthenticatorDialogReopen();
  }

  private scheduleGateResolution(): void {
    if (this.gateResolvePromise) {
      return;
    }

    this.gateResolvePromise = this.runGateResolution().finally(() => {
      this.gateResolvePromise = null;
    });
  }

  private async ensureGateResolved(): Promise<void> {
    if (this.gateResolvePromise) {
      await this.gateResolvePromise;
      return;
    }

    await this.runGateResolution();
  }

  private async runGateResolution(): Promise<void> {
    if (isMandatoryLockSuspended()) {
      resumeMandatoryLock();
    }

    const userId = await this.waitForActiveUnlockedAccount();
    if (!userId) {
      mandatory2faLog("active account = null (timed out waiting for unlocked account)");
      failSafeUnresolvedGate();
      await this.navigateToMandatorySetupIfNeeded();
      return;
    }

    mandatory2faLog("active account loaded", { userId });

    enterPostLoginVerificationState();

    const phase = await resolveMandatoryAuthenticatorGate(this.twoFactorService);
    this.lockService.syncDomLockClass();

    if (phase === "released") {
      this.resumeServerNotifications();
      mandatory2faLog("navigating to vault");
      return;
    }

    this.pauseServerNotifications();
    await this.navigateToMandatorySetupIfNeeded();
  }

  /** Fail-safe: never release vault when 2FA state is unknown or unresolved. */
  private applyFailSafeRestrictedState(): void {
    failSafeUnresolvedGate();
    this.lockService.syncDomLockClass();
    this.pauseServerNotifications();
    void this.navigateToMandatorySetupIfNeeded();
  }

  private pauseServerNotifications(): void {
    this.serverNotificationsService.disconnectFromInactivity();
  }

  private resumeServerNotifications(): void {
    this.serverNotificationsService.reconnectFromActivity();
  }

  /**
   * Wait until activeAccount$ has an id and auth status is Unlocked.
   * Must not complete early on transient null account emissions.
   */
  private async waitForActiveUnlockedAccount(): Promise<UserId | null> {
    const deadline = Date.now() + ACCOUNT_WAIT_MS;

    while (Date.now() < deadline) {
      const userId = await getActiveAccountUserIdOrNull(this.accountService);
      if (userId) {
        const status = await getAuthStatusOrNull(this.authService, userId);
        if (status === AuthenticationStatus.Unlocked) {
          return userId;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    mandatory2faLog("active account = null (timed out waiting)");
    return null;
  }

  private async navigateToMandatorySetupIfNeeded(): Promise<void> {
    const currentPath = normalizeMandatorySetupPath(this.router.url);
    if (isMandatorySetupAllowedUrl(currentPath) || isMandatoryLockExemptNavigation(currentPath)) {
      return;
    }

    mandatory2faLog("navigating to mandatory 2FA setup", { from: currentPath });
    await this.router.navigate([MANDATORY_TWO_FACTOR_SETUP_URL], { replaceUrl: true });
  }

  /** Wait until the mandatory setup route is active so the setup component can mount. */
  private async waitForSetupRouteActivation(): Promise<void> {
    const target = normalizeMandatorySetupPath(MANDATORY_TWO_FACTOR_SETUP_URL);

    for (let attempt = 0; attempt < 40; attempt++) {
      const current = normalizeMandatorySetupPath(this.router.url);
      if (current === target || current.startsWith(`${target}/`)) {
        // One extra tick lets Angular instantiate the routed component.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
