import type { FetchMiddleware } from "@bitwarden/common/platform/misc/fetch-middleware";

import {
  MANDATORY_AUTHENTICATOR_SETUP_MESSAGE,
  shouldBlockMandatoryVaultApiRequest,
} from "./mandatory-authenticator.policy";

let middlewareRegistered = false;

/** Prevents duplicate registration when enforcement start() runs more than once. */
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
