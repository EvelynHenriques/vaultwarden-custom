import { Component, OnInit, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { UserDecryptionOptionsServiceAbstraction } from "@bitwarden/auth/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";

import { HeaderModule } from "../../../layouts/header/header.module";
import { SharedModule } from "../../../shared";
import { getActiveAccountUserIdOrNull } from "../../../vault/guards/mandatory-authenticator-account.util";
import { getMandatoryGatePhase } from "../../../vault/guards/mandatory-authenticator.policy";
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
  }

  private syncMandatoryTwoFactorOnly(): void {
    this.mandatoryTwoFactorOnly = getMandatoryGatePhase() === "blocked";
  }
}
