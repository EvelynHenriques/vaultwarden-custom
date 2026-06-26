import type { FetchMiddleware } from "@bitwarden/common/platform/misc/fetch-middleware";

import {
  MANDATORY_AUTHENTICATOR_SETUP_MESSAGE,
  isIdentityServerRequest,
  markCurrentAuthFlowPassedTotp,
  mandatory2faLog,
  shouldBlockMandatoryVaultApiRequest,
} from "./mandatory-authenticator.policy";

let middlewareRegistered = false;

export function registerMandatoryAuthenticatorApiMiddleware(
  addMiddleware: (middleware: FetchMiddleware) => void,
): void {
  if (middlewareRegistered) {
    return;
  }
  middlewareRegistered = true;
  addMiddleware(createMandatoryAuthenticatorApiMiddleware());
}

export function resetMandatoryAuthenticatorApiMiddlewareRegistration(): void {
  middlewareRegistered = false;
}

export function createMandatoryAuthenticatorApiMiddleware(): FetchMiddleware {
  return async (request, next) => {
    // Never intercept, wrap, or block Identity Server traffic (login, token exchange, SSO).
    if (isIdentityServerRequest(request)) {
      const tokenRequestHadTwoFactor = isIdentityTokenRequest(request)
        ? await requestContainsTwoFactorToken(request)
        : false;
      const response = await next(request);
      if (tokenRequestHadTwoFactor && response.status >= 200 && response.status < 300) {
        markCurrentAuthFlowPassedTotp("identity/connect/token 2FA success");
      }
      return response;
    }

    if (!shouldBlockMandatoryVaultApiRequest(request)) {
      return next(request);
    }

    mandatory2faLog("blocked API request; mandatory Authenticator setup required", {
      url: request.url,
    });

    return new Response(
      JSON.stringify({
        Message: MANDATORY_AUTHENTICATOR_SETUP_MESSAGE,
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
}

function isIdentityTokenRequest(request: Request): boolean {
  try {
    const pathname = new URL(request.url, "https://localhost").pathname;
    return pathname.endsWith("/identity/connect/token") || pathname.endsWith("/connect/token");
  } catch {
    return false;
  }
}

async function requestContainsTwoFactorToken(request: Request): Promise<boolean> {
  try {
    const body = await request.clone().text();
    const form = new URLSearchParams(body);
    const twoFactorToken =
      form.get("twoFactorToken") ?? form.get("TwoFactorToken") ?? form.get("two_factor_token");
    const provider =
      form.get("twoFactorProvider") ?? form.get("TwoFactorProvider") ?? form.get("provider");
    if (twoFactorToken != null && twoFactorToken.trim() !== "") {
      return provider == null || provider === "" || provider === "0";
    }

    try {
      const json = JSON.parse(body) as {
        twoFactorToken?: string;
        TwoFactorToken?: string;
        twoFactorProvider?: number | string;
        TwoFactorProvider?: number | string;
      };
      const jsonToken = json.twoFactorToken ?? json.TwoFactorToken;
      const jsonProvider = json.twoFactorProvider ?? json.TwoFactorProvider;
      return (
        jsonToken != null &&
        String(jsonToken).trim() !== "" &&
        (jsonProvider == null || String(jsonProvider) === "0")
      );
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
