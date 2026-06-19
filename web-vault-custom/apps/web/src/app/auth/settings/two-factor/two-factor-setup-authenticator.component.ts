// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Inject, OnDestroy, OnInit, Output, inject } from "@angular/core";
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from "@angular/forms";
import { firstValueFrom, map } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { UpdateTwoFactorAuthenticatorRequest } from "@bitwarden/common/auth/models/request/update-two-factor-authenticator.request";
import { TwoFactorAuthenticatorResponse } from "@bitwarden/common/auth/models/response/two-factor-authenticator.response";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { AuthResponse } from "@bitwarden/common/auth/types/auth-response";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import {
  AsyncActionsModule,
  ButtonModule,
  CalloutModule,
  DIALOG_DATA,
  DialogConfig,
  DialogModule,
  DialogRef,
  DialogService,
  FormFieldModule,
  IconModule,
  SvgModule,
  InputModule,
  LinkModule,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { TwoFactorSetupMethodBaseComponent } from "./two-factor-setup-method-base.component";
import { MandatoryAuthenticatorLockService } from "../../../vault/guards/mandatory-authenticator-lock.service";

// NOTE: There are additional options available but these are just the ones we are current using.
// See: https://github.com/neocotic/qrious#examples
interface QRiousOptions {
  element: HTMLElement;
  value: string;
  size: number;
}

declare global {
  interface Window {
    QRious: new (options: QRiousOptions) => unknown;
  }
}

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-two-factor-setup-authenticator",
  templateUrl: "two-factor-setup-authenticator.component.html",
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DialogModule,
    FormFieldModule,
    IconModule,
    InputModule,
    LinkModule,
    TypographyModule,
    CalloutModule,
    ButtonModule,
    SvgModule,
    I18nPipe,
    AsyncActionsModule,
    JslibModule,
  ],
})
export class TwoFactorSetupAuthenticatorComponent
  extends TwoFactorSetupMethodBaseComponent
  implements OnInit, OnDestroy
{
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-output-emitter-ref
  @Output() onChangeStatus = new EventEmitter<boolean>();
  type = TwoFactorProviderType.Authenticator;
  key: string;
  readonly omSupportMessage =
    "Em caso de dificuldades, entre em contato com a seção de informática da sua OM.";
  private userVerificationToken: string;

  override componentName = "app-two-factor-authenticator";
  qrScriptError = false;
  private qrScript: HTMLScriptElement;
  mandatoryLockActive = false;

  private readonly lockService = inject(MandatoryAuthenticatorLockService);

  formGroup = this.formBuilder.group({
    token: new FormControl(null, [Validators.required, Validators.minLength(6)]),
  });

  constructor(
    @Inject(DIALOG_DATA) protected data: AuthResponse<TwoFactorAuthenticatorResponse>,
    private dialogRef: DialogRef,
    twoFactorService: TwoFactorService,
    i18nService: I18nService,
    userVerificationService: UserVerificationService,
    private formBuilder: FormBuilder,
    platformUtilsService: PlatformUtilsService,
    logService: LogService,
    private accountService: AccountService,
    dialogService: DialogService,
    private configService: ConfigService,
    protected toastService: ToastService,
  ) {
    super(
      twoFactorService,
      i18nService,
      platformUtilsService,
      logService,
      userVerificationService,
      dialogService,
      toastService,
    );
    this.qrScript = window.document.createElement("script");
    this.qrScript.src = "scripts/qrious.min.js";
    this.qrScript.async = true;
  }

  async ngOnInit() {
    this.mandatoryLockActive = this.lockService.isLockModeActive() && !this.enabled;
    if (this.mandatoryLockActive) {
      this.dialogRef.disableClose = true;
    }

    window.document.body.appendChild(this.qrScript);
    await this.auth(this.data);
  }

  ngOnDestroy() {
    window.document.body.removeChild(this.qrScript);
  }

  validateTokenControl() {
    this.formGroup.controls.token.markAsTouched();
  }

  async auth(authResponse: AuthResponse<TwoFactorAuthenticatorResponse>) {
    super.auth(authResponse);
    return this.processResponse(authResponse.response);
  }

  submit = async () => {
    if (this.formGroup.invalid || this.enabled) {
      return;
    }

    await this.enable();
    this.onChangeStatus.emit(this.enabled);
  };

  protected async enable() {
    const request = await this.buildRequestModel(UpdateTwoFactorAuthenticatorRequest);
    request.token = this.formGroup.value.token;
    request.key = this.key;
    request.userVerificationToken = this.userVerificationToken;

    const response = await this.twoFactorService.putTwoFactorAuthenticator(request);
    await this.processResponse(response);
    this.onUpdated.emit(true);
  }

  private async processResponse(response: TwoFactorAuthenticatorResponse) {
    this.formGroup.get("token").setValue(null);
    this.enabled = response.enabled;
    this.mandatoryLockActive = this.lockService.isLockModeActive() && !this.enabled;
    if (this.mandatoryLockActive) {
      this.dialogRef.disableClose = true;
    } else {
      this.dialogRef.disableClose = false;
    }
    this.key = response.key;
    this.userVerificationToken = response.userVerificationToken;

    await this.waitForQRiousToLoadOrError().catch((error) => {
      this.logService.error(error);
      this.qrScriptError = true;
    });

    await this.createQRCode();
  }

  private async waitForQRiousToLoadOrError(): Promise<void> {
    // Check if QRious is already loaded or if there was an error loading it either way don't wait for it to try and load again
    if (typeof window.QRious !== "undefined" || this.qrScriptError) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.qrScript.onload = () => resolve();
      this.qrScript.onerror = () =>
        reject(new Error(this.i18nService.t("twoStepAuthenticatorQRCanvasError")));
    });
  }

  private async createQRCode() {
    if (this.qrScriptError) {
      return;
    }
    const email = await firstValueFrom(
      this.accountService.activeAccount$.pipe(map((a) => a?.email)),
    );
    new window.QRious({
      element: document.getElementById("qr"),
      value:
        "otpauth://totp/EBVault:" +
        Utils.encodeRFC3986URIComponent(email) +
        "?secret=" +
        encodeURIComponent(this.key) +
        "&issuer=EBVault",
      size: 160,
    });
  }

  static open(
    dialogService: DialogService,
    config: DialogConfig<AuthResponse<TwoFactorAuthenticatorResponse>>,
  ) {
    return dialogService.open<boolean>(TwoFactorSetupAuthenticatorComponent, config);
  }

  async launchExternalUrl(url: string) {
    const hostname = new URL(url).hostname;
    const confirmed = await this.dialogService.openSimpleDialog({
      title: this.i18nService.t("continueToExternalUrlTitle", hostname),
      content: this.i18nService.t("continueToExternalUrlDesc"),
      type: "info",
      acceptButtonText: { key: "continue" },
    });
    if (confirmed) {
      this.platformUtilsService.launchUri(url);
    }
  }
}
