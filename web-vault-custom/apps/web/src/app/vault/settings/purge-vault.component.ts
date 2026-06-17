import { Component } from "@angular/core";
import { DialogService } from "@bitwarden/components";

@Component({ template: "" })
export class PurgeVaultComponent {
  static open(dialogService: DialogService) {
    return dialogService.open(PurgeVaultComponent, {});
  }
}
