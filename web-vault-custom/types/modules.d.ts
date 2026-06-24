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
  export function Injectable(metadata?: unknown): ClassDecorator;
  export function Inject(token: unknown): ParameterDecorator;
  export function Output(): PropertyDecorator;
  export function computed<T>(computation: () => T): Signal<T>;
  export class EventEmitter<T> {
    emit(value: T): void;
  }
  export class DestroyRef {
    onDestroy(callback: () => void): () => void;
  }
  export class NgZone {
    run(fn: () => void): void;
    runOutsideAngular(fn: () => void): void;
  }
  export interface OnInit {
    ngOnInit(): unknown;
  }
  export interface OnDestroy {
    ngOnDestroy(): unknown;
  }
  export interface Signal<T> {
    (): T;
  }
}

declare module "@angular/core/rxjs-interop" {
  import { DestroyRef } from "@angular/core";
  import { Observable } from "rxjs";

  export function takeUntilDestroyed<T>(
    destroyRef?: DestroyRef,
  ): import("rxjs").OperatorFunction<T, T>;
  export function toSignal<T>(
    source: Observable<T>,
    options?: unknown,
  ): import("@angular/core").Signal<T | undefined>;
}

declare module "@angular/platform-browser" {
  export class Title {
    setTitle(title: string): void;
  }
}

declare module "@angular/router" {
  export interface RouterStateSnapshot {
    url: string;
  }
  export class NavigationEnd {
    urlAfterRedirects: string;
  }
  export class NavigationStart {
    url: string;
  }
  export type CanActivateFn = (
    route: unknown,
    state: RouterStateSnapshot,
  ) => boolean | Promise<boolean | UrlTree> | UrlTree;
  export type CanActivateChildFn = CanActivateFn;
  export class Router {
    url: string;
    events: import("rxjs").Observable<unknown>;
    createUrlTree(commands: string[]): UrlTree;
    navigate(commands: string[], extras?: { replaceUrl?: boolean }): Promise<boolean>;
    navigateByUrl(url: string, extras?: { replaceUrl?: boolean }): Promise<boolean>;
  }
  export class RouterModule {}
  export class ActivatedRoute {}
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
    subscribe(
      next?: (value: T) => void,
      error?: (err: unknown) => void,
      complete?: () => void,
    ): Subscription;
    subscribe(observer: {
      next?: (value: T) => void;
      error?: (err: unknown) => void;
      complete?: () => void;
    }): Subscription;
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
  export function filter<T>(predicate: (value: T) => boolean): OperatorFunction<T, T>;
  export function map<T, R>(project: (value: T, index?: number) => R): OperatorFunction<T, R>;
  export function takeUntil<T>(notifier: Observable<unknown>): OperatorFunction<T, T>;
  export function switchMap<T, R>(project: (value: T) => Observable<R>): OperatorFunction<T, R>;
  export function distinctUntilChanged<T>(): OperatorFunction<T, T>;
  export function combineLatest<T extends readonly unknown[]>(
    sources: [...{ [K in keyof T]: Observable<T[K]> }],
  ): Observable<T>;
  export function withLatestFrom<T, R>(
    ...sources: Array<Observable<R>>
  ): OperatorFunction<T, [T, ...R[]]>;
  export function timeout<T>(config: {
    first: number;
    with: () => Error;
  }): OperatorFunction<T, T>;
  export const EMPTY: Observable<never>;
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
    switchAccount(account: null): Promise<void>;
    clean(userId: string): Promise<void>;
    setAccountActivity(userId: string, date: Date): Promise<void>;
  }
}

declare module "@bitwarden/common/auth/abstractions/auth.service" {
  export class AuthService {
    authStatusFor$(userId: string): import("rxjs").Observable<number>;
    logOut(callback: () => Promise<void>, userId: string): void;
  }
}

declare module "@bitwarden/common/auth/abstractions/token.service" {
  export class TokenService {
    clearTokens(userId: string): Promise<void>;
  }
}

declare module "@bitwarden/common/auth/enums/authentication-status" {
  export const enum AuthenticationStatus {
    LoggedOut = 0,
    Locked = 1,
    Unlocked = 2,
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
  export class ConfigService {
    ensureConfigFetched(): Promise<void>;
    getFeatureFlag$(flag: unknown): import("rxjs").Observable<boolean>;
  }
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
  export class LockService {
    lock(userId: string): Promise<void>;
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
    id: string;
    userIsManagedByOrganization: boolean;
    enabled?: boolean;
    limitCollectionCreation?: boolean;
    limitCollectionDeletion?: boolean;
    canAccessEventLogs?: boolean;
    isOwner?: boolean;
    canAccessReports?: boolean;
  }

  export class OrganizationService {
    organizations$(userId: string): Observable<Organization[]>;
  }

  export class InternalOrganizationServiceAbstraction {
    organizations$(userId: string): Observable<Organization[]>;
    upsert(organization: Organization, userId: string): Promise<void>;
  }

  export function canAccessEmergencyAccess(
    userId: string,
    configService: unknown,
    policyService: unknown,
  ): import("rxjs").Observable<boolean>;
}

declare module "@bitwarden/components" {
  export class DialogRef<T = unknown, U = unknown> {
    componentInstance: U;
    disableClose: boolean;
    close(result?: unknown, options?: unknown): void;
    closed: import("rxjs").Observable<T>;
    cdkDialogRefBase?: DialogRef<T, U>;
  }
  export class DialogService {
    openSimpleDialog(config: unknown): Promise<boolean>;
    open<T>(component: unknown, config: unknown): DialogRef<unknown, T>;
    closeAll(): void;
  }
  export class ItemModule {}
  export class ToastService {
    showToast(config: unknown): void;
    _showToast(message: unknown): void;
  }
  export class RouterFocusManagerService {
    start$: import("rxjs").Observable<unknown>;
  }
  export class PopoverModule {}
  export class BannerModule {}
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
    disableClose?: boolean;
    closeOnNavigation?: boolean;
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

declare module "@bitwarden/angular/auth/services/device-trust-toast.service.abstraction" {
  export class DeviceTrustToastService {
    setupListeners$: import("rxjs").Observable<unknown>;
  }
}

declare module "@bitwarden/angular/platform/i18n" {
  export class DocumentLangSetter {
    start(): import("rxjs").Subscription;
  }
}

declare module "@bitwarden/common/dirt/event-logs" {
  export class EventUploadService {
    uploadEvents(): Promise<void>;
  }
}

declare module "@bitwarden/common/key-management/abstractions/process-reload.service" {
  export class ProcessReloadServiceAbstraction {
    startProcessReload(): Promise<void>;
  }
}

declare module "@bitwarden/common/platform/abstractions/broadcaster.service" {
  export class BroadcasterService {
    subscribe(id: string, callback: (message: { command?: string; redirect?: boolean; successfully?: boolean; organizationId?: string; enabled?: boolean; limitCollectionCreation?: boolean; limitCollectionDeletion?: boolean }) => void | Promise<void>): void;
    unsubscribe(id: string): void;
  }
}

declare module "@bitwarden/common/platform/abstractions/state.service" {
  export class StateService {
    clean(options: { userId: string }): Promise<void>;
  }
}

declare module "@bitwarden/common/platform/server-notifications" {
  export class ServerNotificationsService {
    disconnectFromInactivity(): void;
    reconnectFromActivity(): void;
  }
}

declare module "@bitwarden/common/platform/state" {
  export class StateEventRunnerService {
    handleEvent(event: string, userId: string): Promise<void>;
  }
}

declare module "@bitwarden/common/vault/abstractions/cipher.service" {
  export class CipherService {
    clear(userId: string): Promise<void>;
  }
}

declare module "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction" {
  export class InternalFolderService {
    clear(userId: string): Promise<void>;
  }
}

declare module "@bitwarden/key-management" {
  export class KeyService {
    clearKeys(userId: string): Promise<void>;
  }
  export class BiometricStateService {
    logout(userId: string): Promise<void>;
  }
}

declare module "@bitwarden/common/platform/sync" {
  export class SyncService {
    fullSync(force?: boolean): Promise<void>;
  }
}

declare module "@bitwarden/assets/svg" {
  export const PasswordManagerLogo: unknown;
  export const AdminConsoleLogo: unknown;
}

declare module "@bitwarden/send-ui" {
  export class SendPolicyService {
    disableSend$: import("rxjs").Observable<boolean>;
  }
}

declare module "../vault/components/coachmark" {
  export class CoachmarkComponent {}
  export class CoachmarkService {
    activeStepId(): string | null;
    getStepPosition(stepId: string): unknown;
  }
}

declare module "./web-layout.module" {
  export class WebLayoutModule {}
}

declare module "../../../layouts/web-layout.module" {
  export class WebLayoutModule {}
}

declare module "../../../shared" {
  export class SharedModule {}
}

declare module "../../../shared/shared.module" {
  export class SharedModule {}
}
