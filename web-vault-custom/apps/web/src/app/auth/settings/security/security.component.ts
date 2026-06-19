import { Component, OnInit, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { UserDecryptionOptionsServiceAbstraction } from "@bitwarden/auth/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

import { HeaderModule } from "../../../layouts/header/header.module";
import { SharedModule } from "../../../shared";
import {
  ensureMandatoryAuthenticatorStatus,
  isMandatoryAuthenticatorSetupComplete,
  isMandatoryAuthenticatorSetupRequired,
} from "../../../vault/guards/mandatory-authenticator.policy";
import { MandatoryAuthenticatorEnforcementService } from "../../../vault/guards/mandatory-authenticator-enforcement.service";

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

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly twoFactorService = inject(TwoFactorService);
  private readonly enforcementService = inject(MandatoryAuthenticatorEnforcementService);

  constructor(
    private userDecryptionOptionsService: UserDecryptionOptionsServiceAbstraction,
    private accountService: AccountService,
  ) {}

  async ngOnInit() {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    this.showChangePassword = userId
      ? await firstValueFrom(this.userDecryptionOptionsService.hasMasterPasswordById$(userId))
      : false;

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    this.mandatoryTwoFactorOnly =
      !isMandatoryAuthenticatorSetupComplete() && isMandatoryAuthenticatorSetupRequired();

    if (this.mandatoryTwoFactorOnly) {
      await this.router.navigate(["two-factor"], { relativeTo: this.route, replaceUrl: true });
      return;
    }

    await this.enforcementService.redirectIfBlocked(this.router.url, true);
  }
}
