// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, computed, inject, OnDestroy, OnInit, Signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, NavigationStart, Router, RouterModule } from "@angular/router";
import { filter, map, Observable, Subject, switchMap, takeUntil } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { PasswordManagerLogo } from "@bitwarden/assets/svg";
import { canAccessEmergencyAccess } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { PopoverModule, SvgModule } from "@bitwarden/components";
import { SendPolicyService } from "@bitwarden/send-ui";

import { CoachmarkComponent, CoachmarkService } from "../vault/components/coachmark";
import {
  ensureMandatoryAuthenticatorStatus,
  isMandatoryAuthenticatorSetupComplete,
  isMandatorySetupAllowedUrl,
  MANDATORY_TWO_FACTOR_SETUP_URL,
  normalizeMandatorySetupPath,
} from "../vault/guards/mandatory-authenticator.policy";

import { WebLayoutModule } from "./web-layout.module";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-user-layout",
  templateUrl: "user-layout.component.html",
  imports: [
    CommonModule,
    RouterModule,
    JslibModule,
    WebLayoutModule,
    SvgModule,
    PopoverModule,
    CoachmarkComponent,
  ],
})
export class UserLayoutComponent implements OnInit, OnDestroy {
  protected readonly logo = PasswordManagerLogo;
  protected readonly showEmergencyAccess: Signal<boolean>;
  protected readonly sendEnabled$: Observable<boolean> = this.sendPolicyService.disableSend$.pipe(
    map((disableSend) => !disableSend),
  );

  protected readonly coachmarkService = inject(CoachmarkService);
  protected showRouterOutlet = false;

  protected readonly importCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "importData",
  );

  protected readonly reportsCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "monitorSecurity",
  );

  protected readonly toolsNavGroupOpen = computed(
    () => this.coachmarkService.activeStepId() === "importData",
  );

  private readonly destroy$ = new Subject<void>();
  private readonly router = inject(Router);
  private readonly twoFactorService = inject(TwoFactorService);
  private redirectingToMandatorySetup = false;

  constructor(
    private syncService: SyncService,
    private accountService: AccountService,
    private policyService: PolicyService,
    private configService: ConfigService,
    private sendPolicyService: SendPolicyService,
  ) {
    this.showEmergencyAccess = toSignal(
      this.accountService.activeAccount$.pipe(
        getUserId,
        switchMap((userId) =>
          canAccessEmergencyAccess(userId, this.configService, this.policyService),
        ),
      ),
    );
  }

  async ngOnInit() {
    document.body.classList.remove("layout_frontend");
    document.body.classList.add("vw-authenticated");

    this.router.events
      .pipe(
        filter(
          (event) => event instanceof NavigationStart || event instanceof NavigationEnd,
        ),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.updateRouterOutletVisibility(event.url);
          return;
        }

        void this.enforceMandatoryAuthenticatorAccess(event.urlAfterRedirects);
      });

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);
    await this.enforceMandatoryAuthenticatorAccess(this.router.url);

    if (isMandatoryAuthenticatorSetupComplete()) {
      await this.syncService.fullSync(false);
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove("vw-authenticated");
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateRouterOutletVisibility(url: string): void {
    this.showRouterOutlet =
      isMandatoryAuthenticatorSetupComplete() || isMandatorySetupAllowedUrl(url);
  }

  private async enforceMandatoryAuthenticatorAccess(url: string): Promise<void> {
    if (isMandatoryAuthenticatorSetupComplete()) {
      this.showRouterOutlet = true;
      return;
    }

    if (isMandatorySetupAllowedUrl(url)) {
      this.showRouterOutlet = true;
      return;
    }

    this.showRouterOutlet = false;

    await ensureMandatoryAuthenticatorStatus(this.twoFactorService);

    if (isMandatoryAuthenticatorSetupComplete()) {
      this.showRouterOutlet = true;
      await this.syncService.fullSync(false);
      return;
    }

    const currentPath = normalizeMandatorySetupPath(url);
    const setupPath = normalizeMandatorySetupPath(MANDATORY_TWO_FACTOR_SETUP_URL);

    if (currentPath === setupPath) {
      this.showRouterOutlet = true;
      return;
    }

    if (this.redirectingToMandatorySetup) {
      return;
    }

    this.redirectingToMandatorySetup = true;
    try {
      await this.router.navigateByUrl(MANDATORY_TWO_FACTOR_SETUP_URL, { replaceUrl: true });
      this.showRouterOutlet = true;
    } finally {
      this.redirectingToMandatorySetup = false;
    }
  }
}
