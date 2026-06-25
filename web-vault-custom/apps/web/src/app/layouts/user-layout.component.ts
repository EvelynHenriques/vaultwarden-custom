// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, computed, inject, OnDestroy, OnInit, Signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationStart, Router, RouterModule } from "@angular/router";
import { filter, map, Observable, of, Subject, switchMap, takeUntil } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { PasswordManagerLogo } from "@bitwarden/assets/svg";
import { canAccessEmergencyAccess } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { PopoverModule, SvgModule } from "@bitwarden/components";
import { SendPolicyService } from "@bitwarden/send-ui";

import { CoachmarkComponent, CoachmarkService } from "../vault/components/coachmark";
import { activeAccountUserId$ } from "../vault/guards/mandatory-authenticator-account.util";
import { MandatoryAuthenticatorEnforcementService } from "../vault/guards/mandatory-authenticator-enforcement.service";
import { MandatoryAuthenticatorLockService } from "../vault/guards/mandatory-authenticator-lock.service";

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
  private readonly enforcementService = inject(MandatoryAuthenticatorEnforcementService);
  private readonly lockService = inject(MandatoryAuthenticatorLockService);

  constructor(
    private syncService: SyncService,
    private accountService: AccountService,
    private policyService: PolicyService,
    private configService: ConfigService,
    private sendPolicyService: SendPolicyService,
  ) {
    this.showEmergencyAccess = toSignal(
      activeAccountUserId$(this.accountService).pipe(
        switchMap((userId) =>
          userId
            ? canAccessEmergencyAccess(userId, this.configService, this.policyService)
            : of(false),
        ),
      ),
    );
  }

  async ngOnInit() {
    document.body.classList.remove("layout_frontend");
    document.body.classList.add("vw-authenticated");

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        this.updateRouterOutletVisibility(event.url);
      });

    await this.initializeMandatoryTwoFactorGate();
  }

  ngOnDestroy(): void {
    document.body.classList.remove("vw-authenticated");
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async initializeMandatoryTwoFactorGate(): Promise<void> {
    const setupComplete = await this.enforcementService.waitForMandatoryGate();
    this.lockService.syncDomLockClass();
    this.updateRouterOutletVisibility(this.router.url);

    if (setupComplete) {
      this.showRouterOutlet = true;
      await this.syncService.fullSync(false);
      return;
    }

    this.lockService.requestAuthenticatorDialogReopen();
  }

  private updateRouterOutletVisibility(url: string): void {
    this.showRouterOutlet = !this.enforcementService.shouldHideAuthenticatedContent(url);
  }
}
