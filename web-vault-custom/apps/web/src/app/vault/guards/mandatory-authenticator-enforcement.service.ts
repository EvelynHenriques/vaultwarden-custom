import { inject, Injectable } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter, firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";

import { MandatoryAuthenticatorLockService } from "./mandatory-authenticator-lock.service";
import {
  isMandatoryAuthenticatorSetupComplete,
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
    if (!(await this.isAuthenticated())) {
      return;
    }

    await this.lockService.refreshLockState();

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    await this.redirectIfBlocked(this.router.url, true);
  }

  private async handleNavigationEnd(url: string): Promise<void> {
    if (!(await this.isAuthenticated())) {
      return;
    }

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    await this.redirectIfBlocked(url, true);
  }

  async redirectIfBlocked(url: string, replaceUrl = false): Promise<boolean> {
    if (!(await this.isAuthenticated())) {
      return false;
    }

    await this.lockService.refreshLockState();

    if (isMandatoryAuthenticatorSetupComplete()) {
      return false;
    }

    if (this.lockService.shouldAllowUrl(url)) {
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

  private async isAuthenticated(): Promise<boolean> {
    const userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    if (!userId) {
      return false;
    }

    const status = await firstValueFrom(this.authService.authStatusFor$(userId));
    return status === AuthenticationStatus.Unlocked || status === AuthenticationStatus.Locked;
  }
}

export function isMandatorySecurityChildRouteAllowed(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);
  return (
    path === MANDATORY_TWO_FACTOR_SETUP_URL ||
    path.startsWith(`${MANDATORY_TWO_FACTOR_SETUP_URL}/`)
  );
}
