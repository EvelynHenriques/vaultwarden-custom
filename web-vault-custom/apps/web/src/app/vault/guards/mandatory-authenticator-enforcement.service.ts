import { inject, Injectable } from "@angular/core";
import { NavigationEnd, NavigationStart, Router } from "@angular/router";
import { filter, firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import {
  ensureMandatoryAuthenticatorStatus,
  isMandatoryAuthenticatorSetupComplete,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  normalizeMandatorySetupPath,
  shouldBlockMandatorySetupNavigation,
} from "./mandatory-authenticator.policy";

/**
 * App-wide mandatory 2FA enforcement. Started from AppComponent so every navigation
 * (sidebar, tabs, direct URL, back/forward, reload) is covered even outside UserLayout.
 */
@Injectable({ providedIn: "root" })
export class MandatoryAuthenticatorEnforcementService {
  private started = false;
  private redirectInFlight = false;

  private readonly router = inject(Router);
  private readonly twoFactorService = inject(TwoFactorService);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    void this.bootstrapAuthenticatedSession();

    this.router.events
      .pipe(filter((event) => event instanceof NavigationStart || event instanceof NavigationEnd))
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          void this.handleNavigationStart(event.url);
          return;
        }
        void this.handleNavigationEnd(event.urlAfterRedirects);
      });
  }

  private async bootstrapAuthenticatedSession(): Promise<void> {
    if (!(await this.isAuthenticated())) {
      return;
    }

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    await this.redirectIfBlocked(this.router.url, true);
  }

  private async handleNavigationStart(url: string): Promise<void> {
    if (!(await this.isAuthenticated())) {
      return;
    }

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }

    if (!shouldBlockMandatorySetupNavigation(url)) {
      return;
    }

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);

    if (isMandatoryAuthenticatorSetupComplete()) {
      return;
    }
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
    if (isMandatoryAuthenticatorSetupComplete()) {
      return false;
    }

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);

    if (isMandatoryAuthenticatorSetupComplete()) {
      return false;
    }

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

  isRouteAllowed(url: string): boolean {
    if (isMandatoryAuthenticatorSetupComplete()) {
      return true;
    }
    return isMandatorySetupAllowedUrl(url);
  }

  shouldHideAuthenticatedContent(url: string): boolean {
    if (isMandatoryAuthenticatorSetupComplete()) {
      return false;
    }
    return shouldBlockMandatorySetupNavigation(url);
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
