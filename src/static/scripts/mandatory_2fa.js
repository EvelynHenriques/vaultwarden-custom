(function () {
  "use strict";

  const REQUIRED_KEY = "vw-mandatory-2fa-required";
  const SETUP_HASH = "#/settings/security/two-factor";
  const STYLE_ID = "vw-mandatory-2fa-styles";
  const SUPPORT_MESSAGE_ID = "vw-mandatory-2fa-support-msg";
  const SUPPORT_MESSAGE_TEXT =
    "Em caso de dificuldades, entre em contato com a seção de informática da sua OM.";
  const SETUP_PATHS = [
    "/settings/security/two-factor",
    "/settings/two-factor",
  ];
  const PUBLIC_HASHES = [
    "#/login",
    "#/sso",
    "#/signup",
    "#/lock",
  ];
  const SIGNUP_HASHES = [
    "#/finish-signup",
    "#/verify-email",
    "#/signup",
    "#/register",
  ];
  const AUTHENTICATOR_LABELS = [
    "authenticator",
    "autenticador",
    "google authenticator",
    "totp",
  ];
  const MANAGE_LABELS = ["manage", "gerenciar"];

  let authenticatorEnabled = false;
  let setupDialogWasOpen = false;

  document.body.classList.add("vw-mandatory-2fa-policy");
  injectPolicyStyles();

  function currentHash() {
    return window.location.hash || "";
  }

  function currentRoute() {
    return `${window.location.pathname}${currentHash()}`;
  }

  function isSetupRoute() {
    const route = currentRoute();
    return SETUP_PATHS.some((path) => route.includes(path));
  }

  function isSignupRoute() {
    const route = currentRoute();
    return SIGNUP_HASHES.some((path) => route.includes(path.slice(1)));
  }

  function isPublicRoute() {
    const route = currentRoute();
    return PUBLIC_HASHES.some((path) => route.includes(path.slice(1)));
  }

  function clearMandatoryState() {
    sessionStorage.removeItem(REQUIRED_KEY);
    authenticatorEnabled = false;
    document.body.classList.remove("vw-mandatory-2fa-lockdown");
  }

  function isRequired() {
    return sessionStorage.getItem(REQUIRED_KEY) === "1";
  }

  function redirectToSetup() {
    if (!isRequired() || isSetupRoute() || isPublicRoute()) {
      return;
    }

    window.location.hash = SETUP_HASH;
  }

  function injectPolicyStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body.vw-mandatory-2fa-policy app-two-factor-setup bit-item:not(.vw-mandatory-2fa-target),
      body.vw-mandatory-2fa-policy app-two-factor-setup bit-callout {
        display: none !important;
      }

      body.vw-mandatory-2fa-policy app-two-factor-setup-authenticator button[bitButton="danger"],
      body.vw-mandatory-2fa-policy app-two-factor-setup-authenticator button[data-testid="disable-button"] {
        display: none !important;
      }

      body.vw-mandatory-2fa-policy .vw-mandatory-2fa-support-msg {
        margin: 1rem 0 0.5rem;
        padding: 0.75rem 1rem;
        border-radius: 0.375rem;
        background: rgba(23, 63, 95, 0.08);
        border: 1px solid rgba(23, 63, 95, 0.15);
        color: inherit;
        font-size: 0.95rem;
        line-height: 1.45;
        text-align: center;
      }

      body.vw-mandatory-2fa-lockdown app-navigation,
      body.vw-mandatory-2fa-lockdown bit-nav-item,
      body.vw-mandatory-2fa-lockdown .side-nav,
      body.vw-mandatory-2fa-lockdown nav[aria-label="Main"] {
        pointer-events: none !important;
        opacity: 0.35 !important;
      }

      body.vw-mandatory-2fa-lockdown .vw-mandatory-2fa-hidden {
        display: none !important;
      }

      body.vw-mandatory-2fa-lockdown app-two-factor-setup button[bitButton="secondary"]:not(.vw-mandatory-2fa-allowed) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function updateLockdown() {
    const active = isRequired() && !authenticatorEnabled;
    document.body.classList.toggle("vw-mandatory-2fa-lockdown", active);

    if (active || isSetupRoute()) {
      markProviderRows();
    }
  }

  function isDisableRequest(url, method) {
    if (!url || typeof url !== "string") {
      return false;
    }

    const normalizedMethod = (method || "GET").toUpperCase();
    const lowerUrl = url.toLowerCase();

    if (normalizedMethod === "DELETE" && lowerUrl.includes("/two-factor/authenticator")) {
      return true;
    }

    if (
      (normalizedMethod === "POST" || normalizedMethod === "PUT") &&
      lowerUrl.includes("/two-factor/disable")
    ) {
      return true;
    }

    return false;
  }

  function isBlockedAlternativeProviderRequest(url, method) {
    if (!url || typeof url !== "string") {
      return false;
    }

    const normalizedMethod = (method || "GET").toUpperCase();
    const lowerUrl = url.toLowerCase();

    if (normalizedMethod === "POST" && lowerUrl.includes("/two-factor/get-recover")) {
      return true;
    }

    const blockedFragments = [
      "/two-factor/get-email",
      "/two-factor/send-email",
      "/two-factor/email",
      "/two-factor/get-duo",
      "/two-factor/duo",
      "/two-factor/get-webauthn",
      "/two-factor/webauthn",
      "/two-factor/get-yubikey",
      "/two-factor/yubikey",
      "/two-factor/send-email-login",
    ];

    return blockedFragments.some((fragment) => lowerUrl.includes(fragment));
  }

  function blockedApiResponse(message) {
    return new Response(JSON.stringify({ message: message }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  function rowLooksLikeAuthenticator(text) {
    const normalized = text.toLowerCase();
    return AUTHENTICATOR_LABELS.some((label) => normalized.includes(label));
  }

  function buttonLooksLikeManage(text) {
    const normalized = text.toLowerCase().trim();
    return MANAGE_LABELS.some((label) => normalized.includes(label));
  }

  function markProviderRows() {
    document.querySelectorAll("app-two-factor-setup bit-item").forEach((row) => {
      const text = row.textContent || "";
      const isAuthenticator = rowLooksLikeAuthenticator(text);
      row.classList.toggle("vw-mandatory-2fa-target", isAuthenticator);
      row.classList.toggle("vw-mandatory-2fa-hidden", !isAuthenticator);
    });
  }

  function decorateAuthenticatorDialog() {
    const dialog = document.querySelector("app-two-factor-setup-authenticator");
    if (!dialog) {
      return;
    }

    dialog.querySelectorAll('button[bitButton="danger"], button[data-testid="disable-button"]').forEach((button) => {
      button.style.display = "none";
      button.setAttribute("aria-hidden", "true");
      button.disabled = true;
    });

    let message = document.getElementById(SUPPORT_MESSAGE_ID);
    if (!message) {
      message = document.createElement("p");
      message.id = SUPPORT_MESSAGE_ID;
      message.className = "vw-mandatory-2fa-support-msg";
      message.textContent = SUPPORT_MESSAGE_TEXT;

      const footer =
        dialog.querySelector('[bitDialogFooter]') ||
        dialog.querySelector("footer") ||
        dialog.querySelector('button[bitButton="primary"]')?.closest("div");

      if (footer && footer.parentElement) {
        footer.parentElement.insertBefore(message, footer);
      } else {
        dialog.appendChild(message);
      }
    }
  }

  function isVerifyDialogOpen() {
    return !!document.querySelector("app-two-factor-verify");
  }

  function isAuthenticatorSetupDialogOpen() {
    return !!document.querySelector("app-two-factor-setup-authenticator");
  }

  function findAuthenticatorManageButton() {
    const rows = document.querySelectorAll("app-two-factor-setup bit-item");

    for (const row of rows) {
      const text = row.textContent || "";
      if (!rowLooksLikeAuthenticator(text)) {
        continue;
      }

      const buttons = row.querySelectorAll("button");
      for (const button of buttons) {
        const label = button.textContent || "";
        if (button.disabled) {
          continue;
        }
        if (buttonLooksLikeManage(label) || buttons.length === 1) {
          button.classList.add("vw-mandatory-2fa-allowed");
          return button;
        }
      }
    }

    return null;
  }

  function openAuthenticatorSetup() {
    if (!isRequired() || authenticatorEnabled || !isSetupRoute() || isPublicRoute()) {
      return;
    }

    if (isVerifyDialogOpen() || isAuthenticatorSetupDialogOpen()) {
      return;
    }

    const manageButton = findAuthenticatorManageButton();
    if (manageButton) {
      manageButton.click();
    }
  }

  function watchSetupDialog() {
    const setupOpen = isAuthenticatorSetupDialogOpen();

    if (setupOpen) {
      decorateAuthenticatorDialog();
    }

    if (setupDialogWasOpen && !setupOpen && isRequired() && !authenticatorEnabled) {
      window.setTimeout(openAuthenticatorSetup, 400);
    }

    setupDialogWasOpen = setupOpen;
  }

  function enforceTwoFactorPagePolicy() {
    if (!isSetupRoute()) {
      return;
    }

    markProviderRows();
    decorateAuthenticatorDialog();
  }

  function enforceSetupFlow() {
    if (isSignupRoute()) {
      clearMandatoryState();
      return;
    }

    enforceTwoFactorPagePolicy();
    redirectToSetup();
    updateLockdown();
    openAuthenticatorSetup();
    watchSetupDialog();
  }

  function setRequired(required) {
    if (required) {
      sessionStorage.setItem(REQUIRED_KEY, "1");
      authenticatorEnabled = false;
      redirectToSetup();
      updateLockdown();
    } else {
      sessionStorage.removeItem(REQUIRED_KEY);
      authenticatorEnabled = true;
      document.body.classList.remove("vw-mandatory-2fa-lockdown");
      updateLockdown();
    }
  }

  function inspectPayload(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (value.MandatoryAuthenticatorSetup === true) {
      setRequired(true);
      return;
    }

    if (value.MandatoryAuthenticatorSetup === false) {
      setRequired(false);
      return;
    }

    if (value.AuthenticatorDisableBlocked === true) {
      return;
    }

    if (Array.isArray(value.data) && value.data.some((item) => item && item.object === "twoFactorProvider")) {
      const hasEnabledAuthenticator = value.data.some(
        (item) => item && Number(item.type) === 0 && item.enabled === true,
      );
      setRequired(!hasEnabledAuthenticator);
      return;
    }

    if (value.twoFactorEnabled === false || value.TwoFactorEnabled === false) {
      setRequired(true);
      return;
    }

    if (value.enabled === true && value.object === "twoFactorAuthenticator") {
      setRequired(false);
      return;
    }

    if (value.object === "register") {
      clearMandatoryState();
      return;
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        inspectPayload(child);
      }
    }
  }

  function inspectText(text) {
    if (
      !text ||
      (!text.includes("twoFactor") &&
        !text.includes("MandatoryAuthenticatorSetup") &&
        !text.includes("AuthenticatorDisableBlocked") &&
        !text.includes('"object":"register"') &&
        !text.includes('"object": "register"'))
    ) {
      return;
    }

    try {
      inspectPayload(JSON.parse(text));
    } catch (_) {
      // Ignore non-JSON responses.
    }
  }

  function shouldBlockRequest(url, method) {
    if (isDisableRequest(url, method)) {
      return "Authenticator app 2FA cannot be disabled";
    }

    if (isBlockedAlternativeProviderRequest(url, method)) {
      return "Only authenticator app 2FA is allowed";
    }

    return null;
  }

  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const method = (init && init.method) || (input && input.method) || "GET";
      const url = typeof input === "string" ? input : input && input.url;
      const blockMessage = shouldBlockRequest(url, method);

      if (blockMessage) {
        return Promise.resolve(blockedApiResponse(blockMessage));
      }

      return originalFetch.apply(this, arguments).then((response) => {
        response
          .clone()
          .text()
          .then(inspectText)
          .catch(function () {});
        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method) {
    this.__vwMandatory2faMethod = method;
    this.__vwMandatory2faUrl = arguments[1];
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const blockMessage = shouldBlockRequest(this.__vwMandatory2faUrl, this.__vwMandatory2faMethod);

    if (blockMessage) {
      Object.defineProperty(this, "status", { value: 403 });
      Object.defineProperty(this, "responseText", {
        value: JSON.stringify({ message: blockMessage }),
      });
      this.dispatchEvent(new Event("load"));
      return;
    }

    this.addEventListener("load", function () {
      if (typeof this.__vwMandatory2faUrl === "string" && this.__vwMandatory2faUrl.includes("/api/")) {
        inspectText(this.responseText);
      }
    });
    return originalSend.apply(this, arguments);
  };

  window.addEventListener("hashchange", enforceSetupFlow);
  window.addEventListener("popstate", enforceSetupFlow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enforceSetupFlow);
  } else {
    enforceSetupFlow();
  }

  window.setInterval(enforceSetupFlow, 500);
})();
