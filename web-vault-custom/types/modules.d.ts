/**
 * Ambient module stubs so this overlay folder can be edited inside the Vaultwarden
 * Rust repo without a full Bitwarden clients `npm ci` install.
 *
 * These declarations are for IDE support only. Real type-checking happens when
 * files are copied into the Bitwarden clients tree and built with `npm run dist:oss:selfhost`.
 */

declare module "@angular/core" {
  export function inject<T>(token: new (...args: never[]) => T): T;
  export function inject<T>(token: abstract new (...args: never[]) => T): T;
  export function Component(metadata: unknown): ClassDecorator;
  export function NgModule(metadata: unknown): ClassDecorator;
  export function Inject(token: unknown): ParameterDecorator;
  export function Output(): PropertyDecorator;
  export class EventEmitter<T> {
    emit(value: T): void;
  }
  export interface OnInit {
    ngOnInit(): unknown;
  }
  export interface OnDestroy {
    ngOnDestroy(): unknown;
  }
}

declare module "@angular/router" {
  export interface RouterStateSnapshot {
    url: string;
  }
  export type CanActivateFn = (
    route: unknown,
    state: RouterStateSnapshot,
  ) => boolean | Promise<boolean | UrlTree> | UrlTree;
  export class Router {
    createUrlTree(commands: string[]): UrlTree;
  }
  export interface UrlTree {}
}

declare module "@angular/common";
declare module "@angular/forms";

declare module "rxjs" {
  export interface OperatorFunction<T, R> {
    (source: Observable<T>): Observable<R>;
  }

  export class Observable<T> {
    pipe<R>(op: OperatorFunction<T, R>): Observable<R>;
    pipe<A, B>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>): Observable<B>;
    pipe(...operations: OperatorFunction<unknown, unknown>[]): Observable<unknown>;
  }

  export class Subject<T> extends Observable<T> {
    next(value: T): void;
    complete(): void;
  }

  export class Subscription {
    unsubscribe(): void;
  }

  export function firstValueFrom<T>(source: Observable<T>): Promise<T>;
  export function lastValueFrom<T>(source: Observable<T>): Promise<T>;
  export function first<T>(): OperatorFunction<T, T>;
  export function map<T, R>(project: (value: T, index?: number) => R): OperatorFunction<T, R>;
  export function takeUntil<T>(notifier: Observable<unknown>): OperatorFunction<T, T>;
  export function switchMap<T, R>(project: (value: T) => Observable<R>): OperatorFunction<T, R>;
}

declare module "rxjs/operators";

declare module "@bitwarden/common/auth/enums/two-factor-provider-type" {
  export const enum TwoFactorProviderType {
    Authenticator = 0,
    Email = 1,
    Duo = 2,
    OrganizationDuo = 3,
    WebAuthn = 4,
    Yubikey = 5,
    Remember = 6,
  }
}

declare module "@bitwarden/common/auth/two-factor" {
  import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";

  export class TwoFactorService {
    getEnabledTwoFactorProviders(): Promise<{
      data: Array<{ type: TwoFactorProviderType; enabled: boolean }>;
    }>;
    putTwoFactorDisable(request: unknown): Promise<unknown>;
    putTwoFactorAuthenticator(request: unknown): Promise<unknown>;
    deleteTwoFactorAuthenticator(request: unknown): Promise<unknown>;
  }

  export const TwoFactorProviders: Record<string, unknown>;
}

declare module "@bitwarden/common/auth/abstractions/account.service" {
  export class AccountService {
    activeAccount$: import("rxjs").Observable<{ id: string; email?: string } | null>;
  }
}

declare module "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction" {
  export class UserVerificationService {
    buildRequest<T>(secret: unknown, ctor: unknown): Promise<T>;
  }
}

declare module "@bitwarden/common/auth/models/request/two-factor-provider.request" {
  export class TwoFactorProviderRequest {
    type: number;
  }
}

declare module "@bitwarden/common/auth/models/request/update-two-factor-authenticator.request" {
  export class UpdateTwoFactorAuthenticatorRequest {
    token: string;
    key: string;
    userVerificationToken: string;
  }
}

declare module "@bitwarden/common/auth/models/response/two-factor-authenticator.response" {
  export class TwoFactorAuthenticatorResponse {
    enabled: boolean;
    key: string;
    userVerificationToken: string;
  }
}

declare module "@bitwarden/common/auth/models/response/two-factor-duo.response" {
  export class TwoFactorDuoResponse {}
}

declare module "@bitwarden/common/auth/models/response/two-factor-email.response" {
  export class TwoFactorEmailResponse {}
}

declare module "@bitwarden/common/auth/models/response/two-factor-web-authn.response" {
  export class TwoFactorWebAuthnResponse {}
}

declare module "@bitwarden/common/auth/models/response/two-factor-yubi-key.response" {
  export class TwoFactorYubiKeyResponse {}
}

declare module "@bitwarden/common/auth/services/account.service" {
  export function getUserId(
    source: import("rxjs").Observable<unknown>,
  ): import("rxjs").Observable<string>;
}

declare module "@bitwarden/common/auth/types/auth-response" {
  export class AuthResponse<T> {
    response: T;
  }
}

declare module "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction" {
  export class PolicyService {
    policyAppliesToUser$(policy: unknown, userId: string): import("rxjs").Observable<boolean>;
  }
}

declare module "@bitwarden/common/admin-console/enums" {
  export const enum PolicyType {
    TwoFactorAuthentication = 0,
  }
}

declare module "@bitwarden/common/admin-console/models/domain/organization" {
  export class Organization {
    productTierType: number;
  }
}

declare module "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service" {
  export class BillingAccountProfileStateService {
    hasPremiumFromAnySource$(userId: string): import("rxjs").Observable<boolean>;
  }
}

declare module "@bitwarden/common/billing/enums" {
  export const enum ProductTierType {
    Enterprise = 0,
  }
}

declare module "@bitwarden/common/platform/abstractions/config/config.service" {
  export class ConfigService {}
}

declare module "@bitwarden/common/platform/abstractions/i18n.service" {
  export class I18nService {
    t(key: string): string;
  }
}

declare module "@bitwarden/common/platform/abstractions/log.service" {
  export class LogService {
    error(message: unknown): void;
  }
}

declare module "@bitwarden/common/platform/abstractions/messaging.service" {
  export class MessagingService {}
}

declare module "@bitwarden/common/platform/abstractions/platform-utils.service" {
  export class PlatformUtilsService {
    launchUri(url: string): void;
  }
}

declare module "@bitwarden/common/platform/misc/utils" {
  export const Utils: {
    encodeRFC3986URIComponent(value: string): string;
  };
}

declare module "@bitwarden/angular/jslib.module" {
  export class JslibModule {}
}

declare module "@bitwarden/angular/auth/components/two-factor-icon.component" {
  export class TwoFactorIconComponent {}
}

declare module "@bitwarden/angular/billing/components/premium-badge" {
  export class PremiumBadgeComponent {}
}

declare module "@bitwarden/auth/common" {
  export class UserDecryptionOptionsServiceAbstraction {
    hasMasterPasswordById$(userId: string): import("rxjs").Observable<boolean>;
  }
}

declare module "@bitwarden/auth/angular" {
  export class UserVerificationDialogComponent {
    static open(
      dialogService: unknown,
      config: unknown,
    ): Promise<{ userAction: string; verificationSuccess: boolean }>;
  }
}

declare module "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction" {
  import { Observable } from "rxjs";

  export interface Organization {
    userIsManagedByOrganization: boolean;
  }

  export class OrganizationService {
    organizations$(userId: string): Observable<Organization[]>;
  }
}

declare module "@bitwarden/components" {
  export class DialogRef<T, U> {
    componentInstance: U;
    close(): void;
    closed: import("rxjs").Observable<T>;
  }
  export class DialogService {
    openSimpleDialog(config: unknown): Promise<boolean>;
    open<T>(component: unknown, config: unknown): DialogRef<unknown, T>;
  }
  export class ItemModule {}
  export class ToastService {
    showToast(config: unknown): void;
  }
  export class DialogModule {}
  export class FormFieldModule {}
  export class IconModule {}
  export class InputModule {}
  export class LinkModule {}
  export class TypographyModule {}
  export class CalloutModule {}
  export class ButtonModule {}
  export class SvgModule {}
  export class AsyncActionsModule {}
  export const DIALOG_DATA: unknown;
  export class DialogConfig<T> {
    data?: T;
  }
}

declare module "@bitwarden/ui-common" {
  export class I18nPipe {}
}

declare module "../../../layouts/header/header.module" {
  export class HeaderModule {}
}

declare module "../../../shared/shared.module" {
  export class SharedModule {}
}

declare module "./two-factor-setup-method-base.component" {
  import { EventEmitter } from "@angular/core";
  import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
  import { AuthResponse } from "@bitwarden/common/auth/types/auth-response";

  export class TwoFactorSetupMethodBaseComponent {
    enabled: boolean;
    authed: boolean;
    componentName: string;
    onUpdated: EventEmitter<boolean>;
    auth(response: AuthResponse<unknown>): void;
    buildRequestModel<T>(ctor: unknown): Promise<T>;
    disableMethod(): Promise<void>;
    twoFactorService: import("@bitwarden/common/auth/two-factor").TwoFactorService;
    i18nService: import("@bitwarden/common/platform/abstractions/i18n.service").I18nService;
    platformUtilsService: import("@bitwarden/common/platform/abstractions/platform-utils.service").PlatformUtilsService;
    logService: import("@bitwarden/common/platform/abstractions/log.service").LogService;
    userVerificationService: import("@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction").UserVerificationService;
    dialogService: import("@bitwarden/components").DialogService;
    toastService: import("@bitwarden/components").ToastService;
    type: TwoFactorProviderType;
  }
}

declare module "./two-factor-setup-authenticator.component" {
  import { DialogService, DialogConfig } from "@bitwarden/components";
  import { AuthResponse } from "@bitwarden/common/auth/types/auth-response";
  import { TwoFactorAuthenticatorResponse } from "@bitwarden/common/auth/models/response/two-factor-authenticator.response";

  export class TwoFactorSetupAuthenticatorComponent {
    static open(
      dialogService: DialogService,
      config: DialogConfig<AuthResponse<TwoFactorAuthenticatorResponse>>,
    ): import("@bitwarden/components").DialogRef<boolean, TwoFactorSetupAuthenticatorComponent>;
    onChangeStatus: import("@angular/core").EventEmitter<boolean>;
  }
}

declare module "./two-factor-setup-duo.component" {
  export class TwoFactorSetupDuoComponent {
    static open(dialogService: unknown, config: unknown): import("@bitwarden/components").DialogRef<boolean, unknown>;
    onChangeStatus: import("@angular/core").EventEmitter<boolean>;
  }
}

declare module "./two-factor-setup-email.component" {
  export class TwoFactorSetupEmailComponent {
    static open(dialogService: unknown, config: unknown): import("@bitwarden/components").DialogRef<boolean, unknown>;
    onChangeStatus: import("@angular/core").EventEmitter<boolean>;
  }
}

declare module "./two-factor-setup-webauthn.component" {
  export class TwoFactorSetupWebAuthnComponent {
    static open(dialogService: unknown, config: unknown): import("@bitwarden/components").DialogRef<boolean, unknown>;
    onUpdated: import("@angular/core").EventEmitter<boolean>;
  }
}

declare module "./two-factor-setup-yubikey.component" {
  export class TwoFactorSetupYubiKeyComponent {
    static open(dialogService: unknown, config: unknown): import("@bitwarden/components").DialogRef<boolean, unknown>;
    onUpdated: import("@angular/core").EventEmitter<boolean>;
  }
}

declare module "./two-factor-verify.component" {
  export class TwoFactorVerifyComponent {
    static open(dialogService: unknown, config: unknown): {
      closed: import("rxjs").Observable<unknown>;
    };
  }
}
