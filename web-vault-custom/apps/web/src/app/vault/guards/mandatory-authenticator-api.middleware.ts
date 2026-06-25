import type { FetchMiddleware } from "@bitwarden/common/platform/misc/fetch-middleware";

import {
  MANDATORY_AUTHENTICATOR_SETUP_MESSAGE,
  shouldBlockMandatoryVaultApiRequest,
} from "./mandatory-authenticator.policy";

const LOG = "[Mandatory2FA]";

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
    if (!shouldBlockMandatoryVaultApiRequest(request)) {
      return next(request);
    }

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
