import { Router, UrlTree } from "@angular/router";

import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";

export const MANDATORY_TWO_FACTOR_SETUP_URL = "/settings/security/two-factor";

let authenticatorSetupCompleteForSession = false;
let mandatoryAuthenticatorRequired = false;
let providerStatusKnown = false;
let statusCheckPromise: Promise<void> | null = null;

export function markMandatoryAuthenticatorSetupComplete(): void {
  authenticatorSetupCompleteForSession = true;
  mandatoryAuthenticatorRequired = false;
  providerStatusKnown = true;
}

export function resetMandatoryAuthenticatorSetupState(): void {
  authenticatorSetupCompleteForSession = false;
  mandatoryAuthenticatorRequired = false;
  providerStatusKnown = false;
  statusCheckPromise = null;
}

/** @deprecated Use resetMandatoryAuthenticatorSetupState */
export function clearMandatoryAuthenticatorGuardCache(): void {
  resetMandatoryAuthenticatorSetupState();
}

export function isMandatoryAuthenticatorSetupComplete(): boolean {
  return authenticatorSetupCompleteForSession;
}

/** True once we know Authenticator 2FA is still required for this session. */
export function isMandatoryAuthenticatorSetupRequired(): boolean {
  return mandatoryAuthenticatorRequired && !authenticatorSetupCompleteForSession;
}

/** Normalize router URLs (hash routing, query strings). */
export function normalizeMandatorySetupPath(url: string): string {
  let path = url.split("?")[0].split("#")[0].trim();
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path.replace(/\/+$/, "") || "/";
}

/** Only the mandatory Authenticator setup page (and lock screen) are reachable. */
export function isMandatorySetupAllowedUrl(url: string): boolean {
  const path = normalizeMandatorySetupPath(url);

  if (path === "/lock") {
    return true;
  }

  return (
    path === MANDATORY_TWO_FACTOR_SETUP_URL ||
    path.startsWith(`${MANDATORY_TWO_FACTOR_SETUP_URL}/`)
  );
}

async function refreshMandatoryAuthenticatorStatus(
  twoFactorService: TwoFactorService,
): Promise<void> {
  if (statusCheckPromise) {
    await statusCheckPromise;
    return;
  }

  statusCheckPromise = (async () => {
    try {
      const providerList = await twoFactorService.getEnabledTwoFactorProviders();
      const hasEnabledAuthenticator = providerList.data.some(
        (provider) =>
          provider.type === TwoFactorProviderType.Authenticator && provider.enabled === true,
      );

      if (hasEnabledAuthenticator) {
        authenticatorSetupCompleteForSession = true;
        mandatoryAuthenticatorRequired = false;
      } else {
        mandatoryAuthenticatorRequired = true;
      }
    } catch {
      // API errors must redirect to setup — never treat as logout.
      mandatoryAuthenticatorRequired = true;
    } finally {
      providerStatusKnown = true;
      statusCheckPromise = null;
    }
  })();

  await statusCheckPromise;
}

/** Resolves provider status once per session; safe to call from layout init and guards. */
export async function ensureMandatoryAuthenticatorStatus(
  twoFactorService: TwoFactorService,
): Promise<boolean> {
  if (authenticatorSetupCompleteForSession) {
    return true;
  }

  if (!providerStatusKnown) {
    await refreshMandatoryAuthenticatorStatus(twoFactorService);
  }

  return authenticatorSetupCompleteForSession;
}

export async function resolveMandatoryAuthenticatorAccess(
  router: Router,
  twoFactorService: TwoFactorService,
): Promise<boolean | UrlTree> {
  if (authenticatorSetupCompleteForSession) {
    return true;
  }

  if (mandatoryAuthenticatorRequired && providerStatusKnown) {
    return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
  }

  await ensureMandatoryAuthenticatorStatus(twoFactorService);

  if (authenticatorSetupCompleteForSession) {
    return true;
  }

  return router.createUrlTree([MANDATORY_TWO_FACTOR_SETUP_URL]);
}
