import type { FetchMiddleware } from "@bitwarden/common/platform/misc/fetch-middleware";

import {
  MANDATORY_AUTHENTICATOR_SETUP_MESSAGE,
  isIdentityServerRequest,
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
      return next(request);
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
