import { inject, Injectable } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";

import {
  getActiveAccountUserIdOrNull,
  getAuthStatusOrNull,
} from "./mandatory-authenticator-account.util";
import { MandatoryAuthenticatorLockService } from "./mandatory-authenticator-lock.service";
import {
  ensureMandatoryAuthenticatorStatus,
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryPostLoginRouteBlocked,
  isLogoutNavigationTarget,
  isMandatoryLockExemptNavigation,
  isMandatoryLockSuspended,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  normalizeMandatorySetupPath,
} from "./mandatory-authenticator.policy";

/**
 * App-wide mandatory 2FA enforcement. Started from AppComponent so every navigation
 * (sidebar, tabs, direct URL, back/forward, reload) is covered even outside UserLayout.
 */
@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorEnforcementService {
  private started = false;

  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly lockService = inject(MandatoryAuthenticatorLockService);

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.lockService.start();

    void this.bootstrapAuthenticatedSession();

    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        void this.handleNavigationEnd(event.urlAfterRedirects);
      });
  }

  private async bootstrapAuthenticatedSession(): Promise<void> {
    if (isMandatoryLockSuspended()) {
      return;
    }

    if (!(await this.isUnlocked())) {
      return;
    }

    await this.lockService.refreshLockState();

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    await this.redirectIfBlocked(this.router.url, true);
  }

  private async handleNavigationEnd(url: string): Promise<void> {
    if (isMandatoryLockSuspended() || isLogoutNavigationTarget(url)) {
      return;
    }

    if (isMandatoryLockExemptNavigation(url)) {
      return;
    }

    if (!(await this.isUnlocked())) {
      return;
    }

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    await this.redirectIfBlocked(url, true);
  }

  async redirectIfBlocked(url: string, replaceUrl = false): Promise<boolean> {
    if (isMandatoryLockSuspended() || isLogoutNavigationTarget(url)) {
      return false;
    }

    if (isMandatoryLockExemptNavigation(url)) {
      return false;
    }

    if (!(await this.isUnlocked())) {
      return false;
    }

    await this.lockService.refreshLockState();

    if (isMandatoryAuthenticatorSetupComplete()) {
      return false;
    }

    if (isMandatorySetupAllowedUrl(url)) {
      return false;
    }

    if (!isMandatoryPostLoginRouteBlocked(url)) {
      return false;
    }

    return this.lockService.enforceRoute(replaceUrl);
  }

  isRouteAllowed(url: string): boolean {
    return this.lockService.shouldAllowUrl(url);
  }

  shouldHideAuthenticatedContent(url: string): boolean {
    return this.lockService.shouldHideAuthenticatedContent(url);
  }

  private async isUnlocked(): Promise<boolean> {
    const userId = await getActiveAccountUserIdOrNull(this.accountService);
    if (!userId) {
      return false;
    }

    const status = await getAuthStatusOrNull(this.authService, userId);
    return status === AuthenticationStatus.Unlocked;
  }
}

export function isMandatorySecurityChildRouteAllowed(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);
  return (
    path === MANDATORY_TWO_FACTOR_SETUP_URL ||
    path.startsWith(`${MANDATORY_TWO_FACTOR_SETUP_URL}/`)
  );
}
