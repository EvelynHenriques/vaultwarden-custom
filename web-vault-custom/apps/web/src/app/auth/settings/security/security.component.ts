import { Component, DestroyRef, OnInit, inject } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, NavigationEnd, Router } from "@angular/router";
import { filter, firstValueFrom } from "rxjs";

import { UserDecryptionOptionsServiceAbstraction } from "@bitwarden/auth/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";

import { HeaderModule } from "../../../layouts/header/header.module";
import { SharedModule } from "../../../shared";
import { getActiveAccountUserIdOrNull } from "../../../vault/guards/mandatory-authenticator-account.util";
import {
  getMandatoryGatePhase,
  mandatory2faNavLog,
} from "../../../vault/guards/mandatory-authenticator.policy";
import { MandatoryAuthenticatorLockService } from "../../../vault/guards/mandatory-authenticator-lock.service";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "security.component.html",
  imports: [SharedModule, HeaderModule],
})
export class SecurityComponent implements OnInit {
  showChangePassword = true;
  changePasswordRoute = "password";
  mandatoryTwoFactorOnly = false;

  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly lockService = inject(MandatoryAuthenticatorLockService);

  constructor(
    private userDecryptionOptionsService: UserDecryptionOptionsServiceAbstraction,
    private accountService: AccountService,
  ) {}

  async ngOnInit() {
    const userId = await getActiveAccountUserIdOrNull(this.accountService);
    this.showChangePassword = userId
      ? await firstValueFrom(this.userDecryptionOptionsService.hasMasterPasswordById$(userId))
      : false;

    this.lockService.syncDomLockClass();
    this.syncMandatoryTwoFactorOnly();

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.syncMandatoryTwoFactorOnly();
      });

    if (this.mandatoryTwoFactorOnly) {
      mandatory2faNavLog("SecurityComponent/ngOnInit", {
        currentUrl: this.router.url,
        requestedUrl: "two-factor",
        finalUrl: "/settings/security/two-factor",
      });
      await this.router.navigate(["two-factor"], { relativeTo: this.route, replaceUrl: true });
    }
  }

  private syncMandatoryTwoFactorOnly(): void {
    this.mandatoryTwoFactorOnly = getMandatoryGatePhase() === "blocked";
  }
}
