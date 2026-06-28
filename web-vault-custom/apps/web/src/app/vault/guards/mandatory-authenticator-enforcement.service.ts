import { inject, Injectable } from "@angular/core";
import { NavigationEnd, NavigationStart, Router } from "@angular/router";
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
  beginMandatoryAuthFlow,
  confirmMandatoryAuthenticatorRequiredFromApi,
  enterPostLoginVerificationState,
  failSafeUnresolvedGate,
  finishMandatoryAuthFlow,
  getMandatory2faState,
  getMandatoryGatePhase,
  getMandatory2faMode,
  isMandatoryAuthFlowInProgress,
  isMandatory2faEnforcementEnabled,
  isMandatory2faObserveOnly,
  isMandatoryLockSuspended,
  isMandatorySetupAllowedUrl,
  isPreLoginAuthenticationRoute,
  isVaultAccessAllowedByGate,
  mandatory2faDebugLog,
  mandatory2faLog,
  mandatory2faNavLog,
  mandatory2faWarn,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  normalizeMandatorySetupPath,
  resetCurrentAuthFlowTotp,
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

type EbvaultMandatoryGateDecision =
  | { kind: "setup_required" }
  | { kind: "vault_allowed" }
  | { kind: "totp_required" }
  | { kind: "disabled" };

type EbvaultMandatoryGateGlobals = {
  EBVAULT_MANDATORY_2FA_GATE_PROMISE?: Promise<EbvaultMandatoryGateDecision>;
  EBVAULT_MANDATORY_2FA_GATE_DECISION?: EbvaultMandatoryGateDecision;
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
  private gateResolvePromise: Promise<EbvaultMandatoryGateDecision> | null = null;
  private setupNavigationPromise: Promise<void> | null = null;
  private currentAccountId: UserId | null | undefined;
  private focusedRouteDebugUntil = 0;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    mandatory2faLog(`mandatory 2FA mode = ${getMandatory2faMode()}`);

    if (typeof this.apiService.addMiddleware === "function") {
      registerMandatoryAuthenticatorApiMiddleware((middleware) =>
        this.apiService.addMiddleware!(middleware),
      );
      mandatory2faLog("app startup / middleware registered");
    } else {
      mandatory2faLog("app startup / middleware NOT available on ApiService");
    }

    if (!isMandatory2faEnforcementEnabled() && !isMandatory2faObserveOnly()) {
      mandatory2faLog("mandatory 2FA enforcement disabled; original Web Vault lifecycle is untouched");
      return;
    }

    if (isMandatory2faEnforcementEnabled()) {
      this.lockService.initializeUi();
    }
    this.attachAuthRouteListener();

    this.accountService.activeAccount$
      .pipe(
        switchMap((account) => {
          const accountId = account?.id ?? null;
          if (accountId !== this.currentAccountId) {
            this.currentAccountId = accountId;
            if (isMandatoryAuthFlowInProgress()) {
              mandatory2faLog("skip gate reset during active auth flow", {
                reason: "account transition",
                accountId,
                currentUrl: this.router.url,
              });
            } else {
              this.resetGateForRevalidation("account transition");
            }
          }

          if (!account?.id) {
            return EMPTY;
          }
          return this.authService.authStatusFor$(account.id).pipe(distinctUntilChanged());
        }),
      )
      .subscribe((status) => {
        if (!isMandatory2faEnforcementEnabled()) {
          if (status === AuthenticationStatus.Unlocked && isMandatory2faObserveOnly()) {
            mandatory2faLog("observe mode: unlocked session detected; resolving mandatory 2FA state");
            enterPostLoginVerificationState();
            this.scheduleGateResolution();
          }
          return;
        }

        if (isMandatoryAuthFlowInProgress() && isPreLoginAuthenticationRoute(this.router.url)) {
          mandatory2faLog("auth status observed during active login/2FA flow; deferring custom handling", {
            status,
            currentUrl: this.router.url,
          });
          if (status === AuthenticationStatus.Unlocked) {
            enterPostLoginVerificationState();
            const state = getMandatory2faState();
            const currentPath = normalizeMandatorySetupPath(this.router.url);
            if (!state.currentAuthFlowPassedTotp && currentPath.startsWith("/login")) {
              mandatory2faDebugLog("[EBvault 2FA SETUP] restricted session created");
              mandatory2faDebugLog("[EBvault 2FA SETUP] no-TOTP cleanup flow started");
              mandatory2faDebugLog("[EBvault 2FA SETUP] no-TOTP post-login verification started");
              this.scheduleGateResolution();
            }
          }
          return;
        }

        if (status === AuthenticationStatus.LoggedOut) {
          this.pauseServerNotifications();
          this.lockService.prepareForLogout();
          return;
        }

        if (status === AuthenticationStatus.Locked) {
          mandatory2faLog("lock/unlock path selected: full login required before vault access");
          mandatory2faLog("vault locked — mandatory gate will revalidate after unlock");
          resetCurrentAuthFlowTotp("vault locked");
          this.pauseServerNotifications();
          this.resetGateForRevalidation("vault locked");
          mandatory2faNavLog("MandatoryAuthenticatorEnforcementService/authStatusLocked", {
            currentUrl: this.router.url,
            requestedUrl: "/login",
            finalUrl: "/login",
          });
          void this.router.navigate(["/login"], { replaceUrl: true });
          return;
        }

        if (status === AuthenticationStatus.Unlocked) {
          mandatory2faLog("token login success");
          mandatory2faDebugLog("[EBvault 2FA SETUP] restricted session created");
          const state = getMandatory2faState();
          if (!state.currentAuthFlowPassedTotp) {
            mandatory2faDebugLog("[EBvault 2FA SETUP] no-TOTP post-login verification started");
          }
          mandatory2faDebugLog("[EBvault 2FA LOGIN] auth state saved");
          mandatory2faLog("post-login continuation started after successful authentication");
          mandatory2faLog("login or unlock success");
          enterPostLoginVerificationState();
          this.pauseServerNotifications();
          this.scheduleGateResolution();
        }
      });

    void this.bootstrapExistingSession();
  }

  /** Track the original login/2FA flow so custom enforcement does not race it. */
  private attachAuthRouteListener(): void {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        const requestedPath = normalizeMandatorySetupPath(event.url);
        if (
          isMandatorySetupAllowedUrl(requestedPath) ||
          requestedPath === "/vault" ||
          requestedPath === "/login" ||
          requestedPath.startsWith("/login/")
        ) {
          this.focusedRouteDebugUntil = Date.now() + 15_000;
          mandatory2faDebugLog("[EBvault ROUTER TRACE] focused route navigation started", {
            url: event.url,
            requestedPath,
            currentUrl: this.router.url,
          });
        }
        if (isMandatoryAuthFlowInProgress() && !isPreLoginAuthenticationRoute(event.url)) {
          mandatory2faDebugLog("[EBvault ROUTER] NavigationStart", event.url);
          if (isMandatorySetupAllowedUrl(requestedPath)) {
            mandatory2faDebugLog("[EBvault 2FA SETUP] navigation to /settings/security/two-factor started", {
              currentUrl: this.router.url,
              requestedUrl: event.url,
            });
          } else {
            mandatory2faDebugLog("[EBvault 2FA LOGIN] original login flow navigation started", {
              currentUrl: this.router.url,
              requestedUrl: event.url,
            });
          }
        }

        if (requestedPath === "/lock" || requestedPath.startsWith("/lock/")) {
          resetCurrentAuthFlowTotp("lock route reached");
          mandatory2faNavLog("MandatoryAuthenticatorEnforcementService/lockRoute", {
            currentUrl: this.router.url,
            requestedUrl: event.url,
            finalUrl: "/login",
          });
          return;
        }

        if (!isPreLoginAuthenticationRoute(event.url)) {
          return;
        }

        if (requestedPath === "/login" || requestedPath.startsWith("/login/")) {
          resetCurrentAuthFlowTotp("login route reached");
        }

        beginMandatoryAuthFlow("pre-login route navigation");
        return;
      }

      this.logFocusedRouteRouterEvent(event);
      this.logAuthFlowRouterEvent(event);
      this.logMandatorySetupRouterEvent(event);

      if (!(event instanceof NavigationEnd) || !isMandatoryAuthFlowInProgress()) {
        return;
      }

      const finalUrl = event.urlAfterRedirects || this.router.url;
      if (isPreLoginAuthenticationRoute(finalUrl)) {
        return;
      }

      setTimeout(() => {
        mandatory2faDebugLog("[EBvault 2FA LOGIN] original login flow completed", {
          currentUrl: finalUrl,
        });
        if (normalizeMandatorySetupPath(finalUrl) === "/vault") {
          mandatory2faDebugLog("[EBvault 2FA LOGIN] original login flow navigation completed true", {
            currentUrl: finalUrl,
          });
          mandatory2faDebugLog("[EBvault LOGIN] current url /vault");
        }
        if (isMandatorySetupAllowedUrl(finalUrl)) {
          mandatory2faDebugLog("[EBvault 2FA SETUP] setup route NavigationEnd");
          mandatory2faDebugLog("[EBvault 2FA SETUP] navigation completed true");
          mandatory2faDebugLog("[EBvault 2FA SETUP] current url /settings/security/two-factor");
        }
        finishMandatoryAuthFlow("post-login navigation completed");
        this.scheduleGateResolution();
      }, 0);
    });
  }

  private logAuthFlowRouterEvent(event: unknown): void {
    if (!isMandatoryAuthFlowInProgress()) {
      return;
    }

    const currentPath = normalizeMandatorySetupPath(this.router.url);
    if (!isPreLoginAuthenticationRoute(currentPath)) {
      return;
    }

    const eventName = getRouterEventName(event);
    if (!shouldLogRouterEvent(eventName)) {
      return;
    }

    const detail = getRouterEventDetail(event);
    if (eventName === "RoutesRecognized") {
      mandatory2faDebugLog("[EBvault ROUTER MATCH]", getRouterMatchDetail(event));
    }
    if (eventName === "NavigationCancel") {
      mandatory2faDebugLog("[EBvault 2FA LOGIN] router navigation cancelled", detail);
    } else if (eventName === "NavigationError") {
      mandatory2faDebugLog("[EBvault 2FA LOGIN] router navigation error", detail);
    }
    mandatory2faDebugLog("[EBvault ROUTER]", eventName, detail);
  }

  private logMandatorySetupRouterEvent(event: unknown): void {
    const eventName = getRouterEventName(event);
    if (!shouldLogRouterEvent(eventName)) {
      return;
    }

    const detail = getRouterEventDetail(event);
    const url = normalizeMandatorySetupPath(
      String(detail["urlAfterRedirects"] ?? detail["url"] ?? this.router.url),
    );
    if (!isMandatorySetupAllowedUrl(url)) {
      return;
    }

    if (eventName === "RoutesRecognized") {
      mandatory2faDebugLog("[EBvault 2FA SETUP] setup route RoutesRecognized", detail);
    } else if (eventName === "GuardsCheckStart") {
      mandatory2faDebugLog("[EBvault 2FA SETUP] setup route GuardsCheckStart", detail);
    } else if (eventName === "GuardsCheckEnd") {
      mandatory2faDebugLog("[EBvault 2FA SETUP] setup route GuardsCheckEnd", detail);
    } else if (eventName === "NavigationEnd") {
      mandatory2faDebugLog("[EBvault 2FA SETUP] setup route NavigationEnd", detail);
    } else if (eventName === "NavigationCancel") {
      mandatory2faDebugLog("[EBvault 2FA SETUP] setup route NavigationCancel", detail);
    } else if (eventName === "NavigationError") {
      mandatory2faDebugLog("[EBvault 2FA SETUP] setup route NavigationError", detail);
    }
  }

  private logFocusedRouteRouterEvent(event: unknown): void {
    if (Date.now() > this.focusedRouteDebugUntil) {
      return;
    }

    const eventName = getRouterEventName(event);
    if (!shouldLogRouterEvent(eventName)) {
      return;
    }

    const detail = getRouterEventDetail(event);
    const url = normalizeMandatorySetupPath(
      String(detail["urlAfterRedirects"] ?? detail["url"] ?? this.router.url),
    );
    const routePath = typeof detail["routePath"] === "string" ? detail["routePath"] : "";
    const isFocusedUrl =
      isMandatorySetupAllowedUrl(url) ||
      url === "/vault" ||
      url === "/login" ||
      url.startsWith("/login/") ||
      routePath === "settings" ||
      routePath === "security" ||
      routePath === "two-factor";

    if (!isFocusedUrl && eventName !== "RouteConfigLoadStart" && eventName !== "RouteConfigLoadEnd") {
      return;
    }

    mandatory2faDebugLog("[EBvault ROUTER TRACE]", eventName, {
      ...detail,
      currentUrl: this.router.url,
      gatePhase: getMandatoryGatePhase(),
      state: getMandatory2faState(),
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
    if (!isMandatory2faEnforcementEnabled()) {
      return false;
    }
    return shouldHideAuthenticatedContent(url);
  }

  isMandatorySetupPending(): boolean {
    if (!isMandatory2faEnforcementEnabled()) {
      return false;
    }
    const phase = getMandatoryGatePhase();
    return phase === "pending" || phase === "blocked";
  }

  /**
   * Await gate resolution. Event-driven via gate promise; timeout is fail-safe only.
   * Returns true only when Authenticator 2FA is confirmed configured.
   */
  async waitForMandatoryGate(): Promise<boolean> {
    if (!isMandatory2faEnforcementEnabled()) {
      return true;
    }

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
    if (!isMandatory2faEnforcementEnabled()) {
      return false;
    }

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

    if (phase === "pending") {
      mandatory2faLog("gate pending - no navigation decision yet");
      await this.ensureGateResolved();
      if (isVaultAccessAllowedByGate()) {
        mandatory2faLog("setup navigation skipped because authenticator is configured");
        return true;
      }
    }

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
    if (!isMandatory2faEnforcementEnabled()) {
      return;
    }

    await this.navigateToMandatorySetupIfNeeded();
    await this.waitForSetupRouteActivation();
    mandatory2faLog("opening mandatory setup dialog");
    this.lockService.requestAuthenticatorDialogReopen();
  }

  private scheduleGateResolution(): void {
    if (this.gateResolvePromise) {
      return;
    }

    const gatePromise = this.runGateResolution()
      .then((decision) => {
        (globalThis as EbvaultMandatoryGateGlobals).EBVAULT_MANDATORY_2FA_GATE_DECISION = decision;
        return decision;
      })
      .finally(() => {
        const globalGate = globalThis as EbvaultMandatoryGateGlobals;
        if (globalGate.EBVAULT_MANDATORY_2FA_GATE_PROMISE === gatePromise) {
          delete globalGate.EBVAULT_MANDATORY_2FA_GATE_PROMISE;
        }
        this.gateResolvePromise = null;
      });
    this.gateResolvePromise = gatePromise;
    (globalThis as EbvaultMandatoryGateGlobals).EBVAULT_MANDATORY_2FA_GATE_PROMISE = gatePromise;
  }

  private async ensureGateResolved(): Promise<EbvaultMandatoryGateDecision> {
    if (this.gateResolvePromise) {
      return await this.gateResolvePromise;
    }

    return await this.runGateResolution();
  }

  private async runGateResolution(): Promise<EbvaultMandatoryGateDecision> {
    if (isMandatoryLockSuspended()) {
      resumeMandatoryLock();
    }

    const userId = await this.waitForActiveUnlockedAccount();
    if (!userId) {
      mandatory2faLog("active account = null (timed out waiting for unlocked account)");
      failSafeUnresolvedGate();
      await this.navigateToMandatorySetupIfNeeded();
      return { kind: "setup_required" };
    }

    mandatory2faLog("active account loaded", { userId });

    enterPostLoginVerificationState();

    const stateBeforeCheck = getMandatory2faState();
    if (!stateBeforeCheck.currentAuthFlowPassedTotp) {
      mandatory2faDebugLog("[EBvault 2FA SETUP] checking /api/two-factor outside guard");
    }

    const phase = await resolveMandatoryAuthenticatorGate(this.twoFactorService);

    if (!isMandatory2faEnforcementEnabled()) {
      mandatory2faLog(`${getMandatory2faMode()} mode: gate resolved without routing enforcement`, {
        phase,
        state: getMandatory2faState(),
      });
      return { kind: "disabled" };
    }

    this.lockService.syncDomLockClass();

    if (phase === "released") {
      mandatory2faLog("mandatory authenticator status detected: configured");
      mandatory2faDebugLog("[EBvault 2FA LOGIN] gate released");
      await this.resumeServerNotifications();
      mandatory2faLog("gate released; EBvault is not forcing vault navigation");
      mandatory2faNavLog("runGateResolution/released", {
        currentUrl: this.router.url,
        requestedUrl: "original-login-flow",
        finalUrl: "original-login-flow",
      });
      return { kind: "vault_allowed" };
    }

    const state = getMandatory2faState();
    if (state.hasAuthenticatorConfigured && !state.currentAuthFlowPassedTotp) {
      mandatory2faLog("mandatory authenticator configured but current auth flow did not pass TOTP");
      this.pauseServerNotifications();
      mandatory2faLog("selected navigation target: login");
      mandatory2faNavLog("runGateResolution/fullLoginRequired", {
        currentUrl: this.router.url,
        requestedUrl: "/login",
        finalUrl: "/login",
      });
      await this.router.navigate(["/login"], { replaceUrl: true });
      return { kind: "totp_required" };
    }

    if (phase === "pending") {
      mandatory2faLog("gate pending - no navigation decision yet");
      return { kind: "totp_required" };
    }

    mandatory2faLog("mandatory authenticator status detected: not configured");
    mandatory2faDebugLog("[EBvault 2FA SETUP] no-TOTP login flow selected");
    this.pauseServerNotifications();
    mandatory2faLog("selected navigation target: security two-factor setup");
    mandatory2faDebugLog("[EBvault 2FA SETUP] replacing protected destination with /settings/security/two-factor", {
      currentUrl: this.router.url,
    });

    if (
      isMandatoryAuthFlowInProgress() &&
      isPreLoginAuthenticationRoute(normalizeMandatorySetupPath(this.router.url))
    ) {
      mandatory2faDebugLog("[EBvault 2FA SETUP] discarding original protected destination /vault", {
        currentUrl: this.router.url,
      });
      mandatory2faDebugLog("[EBvault 2FA SETUP] direct setup redirect requested");
      mandatory2faLog("no-TOTP state resolved; default /vault navigation skipped; navigating directly to setup");
      return { kind: "setup_required" };
    }

    await this.navigateToMandatorySetupIfNeeded();
    return { kind: "setup_required" };
  }

  /** Fail-safe: never release vault when 2FA state is unknown or unresolved. */
  private applyFailSafeRestrictedState(): void {
    if (!isMandatory2faEnforcementEnabled()) {
      return;
    }

    failSafeUnresolvedGate();
    this.lockService.syncDomLockClass();
    this.pauseServerNotifications();
    void this.navigateToMandatorySetupIfNeeded();
  }

  private pauseServerNotifications(): void {
    try {
      this.serverNotificationsService.disconnectFromInactivity();
    } catch (error) {
      mandatory2faWarn("server notification pause failed; continuing", error);
    }
  }

  private async resumeServerNotifications(): Promise<void> {
    mandatory2faWarn("server notifications resume skipped during mandatory 2FA flow");
  }

  private resetGateForRevalidation(reason: string): void {
    mandatory2faLog(`reset gate for revalidation (${reason})`);
    resetMandatoryAuthenticatorSetupState();
    this.gateResolvePromise = null;
    this.lockService.syncDomLockClass();
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
    if (isMandatorySetupAllowedUrl(currentPath)) {
      mandatory2faLog("current route already mandatory setup route", { currentRoute: currentPath });
      return;
    }

    const state = getMandatory2faState();
    if (
      isMandatoryAuthFlowInProgress() &&
      isPreLoginAuthenticationRoute(currentPath) &&
      state.currentAuthFlowPassedTotp &&
      !state.mandatorySetupRequired &&
      !state.mandatoryGateReleased
    ) {
      mandatory2faLog("setup navigation skipped during pending TOTP login verification", {
        currentRoute: currentPath,
        state,
      });
      mandatory2faNavLog("navigateToMandatorySetupIfNeeded/skippedPendingTotpLogin", {
        currentUrl: this.router.url,
        requestedUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
        finalUrl: "skipped-pending-totp-login",
      });
      return;
    }

    if (this.setupNavigationPromise) {
      mandatory2faDebugLog("[EBvault 2FA SETUP] setup navigation already in progress");
      await this.setupNavigationPromise;
      return;
    }

    this.setupNavigationPromise = this.performMandatorySetupNavigation(currentPath).finally(() => {
      this.setupNavigationPromise = null;
    });
    await this.setupNavigationPromise;
  }

  private async performMandatorySetupNavigation(currentPath: string): Promise<void> {
    mandatory2faLog("current route", currentPath);
    mandatory2faLog("target route", MANDATORY_TWO_FACTOR_SETUP_URL);
    mandatory2faLog("route blocked", {
      route: currentPath,
      reason: "mandatory Authenticator setup required",
    });
    mandatory2faNavLog("navigateToMandatorySetupIfNeeded", {
      currentUrl: this.router.url,
      requestedUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
      finalUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
    });
    mandatory2faDebugLog("[EBvault 2FA SETUP] replacing protected destination with /settings/security/two-factor", {
      currentUrl: this.router.url,
      targetUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
    });

    if (this.shouldSkipMandatorySetupNavigation()) {
      return;
    }

    const protectedDestination = this.currentNavigationTargetUrl() ?? "/vault";
    mandatory2faDebugLog("[EBvault 2FA SETUP] discarding original protected destination /vault", {
      currentUrl: this.router.url,
      protectedDestination,
    });
    mandatory2faDebugLog("[EBvault 2FA SETUP] direct setup redirect requested");
    mandatory2faDebugLog("[EBvault 2FA SETUP] navigating to /settings/security/two-factor");
    await this.router.navigateByUrl(MANDATORY_TWO_FACTOR_SETUP_URL, { replaceUrl: true });
  }

  private shouldSkipMandatorySetupNavigation(): boolean {
    const latestPath = normalizeMandatorySetupPath(this.router.url);
    if (isMandatorySetupAllowedUrl(latestPath)) {
      mandatory2faLog("current route already mandatory setup route", { currentRoute: latestPath });
      return true;
    }

    const latestState = getMandatory2faState();
    if (
      latestState.mandatoryGateReleased ||
      (latestState.hasAuthenticatorConfigured &&
        latestState.currentAuthFlowPassedTotp &&
        !latestState.mandatorySetupRequired)
    ) {
      mandatory2faDebugLog(
        "[EBvault 2FA] setup navigation skipped: Authenticator already configured and current TOTP flow passed",
        {
          currentUrl: this.router.url,
          state: latestState,
        },
      );
      mandatory2faNavLog("navigateToMandatorySetupIfNeeded/skippedReleasedGate", {
        currentUrl: this.router.url,
        requestedUrl: MANDATORY_TWO_FACTOR_SETUP_URL,
        finalUrl: "skipped-released-gate",
      });
      return true;
    }

    if (!latestState.mandatorySetupRequired) {
      mandatory2faLog("setup navigation skipped because mandatory setup is no longer required", {
        currentUrl: this.router.url,
        state: latestState,
      });
      return true;
    }

    return false;
  }

  private currentNavigationTargetUrl(): string | null {
    const router = this.router as Router & { getCurrentNavigation?: () => unknown };
    if (typeof router.getCurrentNavigation !== "function") {
      return null;
    }

    const navigation = router.getCurrentNavigation();
    if (navigation == null || typeof navigation !== "object") {
      return null;
    }

    const safeNavigation = navigation as unknown as Record<string, unknown>;
    const target =
      safeNavigation["finalUrl"] ?? safeNavigation["extractedUrl"] ?? safeNavigation["initialUrl"];
    return target == null ? null : target.toString();
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

function getRouterEventName(event: unknown): string {
  if (event == null || typeof event !== "object") {
    return "UnknownRouterEvent";
  }

  const constructor = (event as { constructor?: { name?: string } }).constructor;
  return constructor?.name ?? "UnknownRouterEvent";
}

function shouldLogRouterEvent(eventName: string): boolean {
  return (
    eventName.includes("Navigation") ||
    eventName.includes("GuardsCheck") ||
    eventName.includes("Resolve") ||
    eventName.includes("RoutesRecognized") ||
    eventName.includes("RouteConfigLoad") ||
    eventName.includes("Activation")
  );
}

function getRouterEventDetail(event: unknown): Record<string, unknown> {
  const safeEvent = event != null && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const route =
    safeEvent["route"] != null && typeof safeEvent["route"] === "object"
      ? (safeEvent["route"] as Record<string, unknown>)
      : {};

  return {
    id: safeEvent["id"],
    url: safeEvent["url"],
    urlAfterRedirects: safeEvent["urlAfterRedirects"],
    shouldActivate: safeEvent["shouldActivate"],
    reason: safeEvent["reason"],
    code: safeEvent["code"],
    error: safeEvent["error"],
    routePath: route["path"],
    routeLoadChildren: route["loadChildren"] == null ? undefined : String(route["loadChildren"]),
  };
}

function getRouterMatchDetail(event: unknown): Record<string, unknown> {
  const safeEvent = event != null && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const state = safeEvent["state"];
  const root = state != null && typeof state === "object" ? (state as Record<string, unknown>)["root"] : null;
  const levels = collectRouteSnapshotLevels(root);

  return {
    url: safeEvent["url"],
    urlAfterRedirects: safeEvent["urlAfterRedirects"],
    matchedPaths: levels.map((level) => level.path),
    canActivateByLevel: levels.map((level) => level.canActivate),
    canActivateChildByLevel: levels.map((level) => level.canActivateChild),
  };
}

function collectRouteSnapshotLevels(root: unknown): Array<{
  path: unknown;
  canActivate: string[];
  canActivateChild: string[];
}> {
  const levels: Array<{
    path: unknown;
    canActivate: string[];
    canActivateChild: string[];
  }> = [];

  let current = root;
  while (current != null && typeof current === "object") {
    const snapshot = current as Record<string, unknown>;
    const routeConfig =
      snapshot["routeConfig"] != null && typeof snapshot["routeConfig"] === "object"
        ? (snapshot["routeConfig"] as Record<string, unknown>)
        : {};
    levels.push({
      path: routeConfig["path"] ?? "",
      canActivate: describeGuardArray(routeConfig["canActivate"]),
      canActivateChild: describeGuardArray(routeConfig["canActivateChild"]),
    });

    const firstChild = snapshot["firstChild"];
    if (firstChild == null || typeof firstChild !== "object") {
      break;
    }
    current = firstChild;
  }

  return levels;
}

function describeGuardArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((guard) => {
    if (typeof guard === "function") {
      return guard.name || "(anonymous guard)";
    }
    if (guard != null && typeof guard === "object") {
      return (guard as { constructor?: { name?: string } }).constructor?.name ?? "object guard";
    }
    return String(guard);
  });
}
