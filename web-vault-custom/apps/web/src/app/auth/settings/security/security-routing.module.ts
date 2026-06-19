import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";

import { DeviceManagementComponent } from "@bitwarden/angular/auth/device-management/device-management.component";

import { mandatoryAuthenticatorGuard } from "../../../vault/guards/mandatory-authenticator.guard";
import { SessionTimeoutComponent } from "../../../key-management/session-timeout/session-timeout.component";
import { TwoFactorSetupComponent } from "../two-factor/two-factor-setup.component";

import { PasswordSettingsComponent } from "./password-settings/password-settings.component";
import { SecurityKeysComponent } from "./security-keys.component";
import { SecurityComponent } from "./security.component";

const routes: Routes = [
  {
    path: "",
    component: SecurityComponent,
    canActivateChild: [mandatoryAuthenticatorGuard],
    runGuardsAndResolvers: "always",
    data: { titleId: "security" },
    children: [
      { path: "", pathMatch: "full", redirectTo: "two-factor" },
      {
        path: "session-timeout",
        component: SessionTimeoutComponent,
        data: { titleId: "sessionTimeoutHeader" },
      },
      {
        path: "password",
        component: PasswordSettingsComponent,
        data: { titleId: "masterPassword" },
      },
      {
        path: "two-factor",
        component: TwoFactorSetupComponent,
        data: { titleId: "twoStepLogin" },
      },
      {
        path: "security-keys",
        component: SecurityKeysComponent,
        data: { titleId: "keys" },
      },
      {
        path: "device-management",
        component: DeviceManagementComponent,
        data: { titleId: "devices" },
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SecurityRoutingModule {}
