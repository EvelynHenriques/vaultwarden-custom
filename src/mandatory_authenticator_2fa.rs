//! Mandatory Authenticator 2FA API gate.
//!
//! While a user has not enrolled Authenticator app 2FA, only endpoints required for
//! enrollment and minimal session bootstrap are reachable. Everything else returns 403.

use rocket::request::Request;

use crate::{
    db::{DbConn, models::{TwoFactor, TwoFactorType, UserId}},
};

/// User-facing error when a protected API is called before Authenticator enrollment.
pub const MANDATORY_AUTHENTICATOR_SETUP_MESSAGE: &str =
    "Authenticator app setup is required before continuing";

/// Returns true when the user has an **enabled** Authenticator 2FA provider.
pub async fn user_has_enabled_authenticator_2fa(user_id: &UserId, conn: &DbConn) -> bool {
    TwoFactor::find_by_user_and_type(user_id, TwoFactorType::Authenticator as i32, conn)
        .await
        .is_some_and(|tf| tf.enabled)
}

/// Rocket route-name whitelist (see `routes!` handler names in api/core).
pub fn is_mandatory_2fa_setup_allowed_route_name(route_name: &str) -> bool {
    matches!(
        route_name,
        // Minimal session bootstrap (no vault sync).
        "revision_date" | "profile"
            // Account initialization after invite/registration.
            | "post_set_password"
            | "post_keys"
            // User verification dialog when enabling Authenticator.
            | "verify_password"
            | "request_otp"
            | "verify_otp"
            // Authenticator enrollment APIs.
            | "get_twofactor"
            | "get_device_verification_settings"
            | "generate_authenticator"
            | "activate_authenticator"
            | "activate_authenticator_put"
    )
}

/// Path fallback when Rocket has no named route (or mount prefixes differ).
pub fn is_mandatory_2fa_setup_allowed_path(path: &str) -> bool {
    let path = path.trim_end_matches('/');

    if path == "/accounts/profile"
        || path == "/accounts/revision-date"
        || path == "/two-factor"
        || path == "/accounts/request-otp"
        || path == "/accounts/verify-otp"
    {
        return true;
    }

    path.starts_with("/two-factor/")
        || path.starts_with("/accounts/verify-password")
        || path.starts_with("/accounts/set-password")
        || path.starts_with("/accounts/keys")
}

pub fn is_mandatory_2fa_setup_allowed_request(request: &Request<'_>) -> bool {
    if let Some(route_name) = request.route().and_then(|route| route.name.as_deref())
        && is_mandatory_2fa_setup_allowed_route_name(route_name)
    {
        return true;
    }

    is_mandatory_2fa_setup_allowed_path(request.uri().path().as_str())
}

pub fn is_authenticator_disable_route(route_name: &str) -> bool {
    matches!(
        route_name,
        "disable_authenticator" | "disable_twofactor" | "disable_twofactor_put"
    )
}

pub fn is_blocked_alternative_twofactor_route(route_name: &str) -> bool {
    matches!(
        route_name,
        "get_recover"
            | "get_email"
            | "send_email"
            | "email"
            | "get_duo"
            | "activate_duo"
            | "activate_duo_put"
            | "get_webauthn"
            | "generate_webauthn_challenge"
            | "activate_webauthn"
            | "activate_webauthn_put"
            | "delete_webauthn"
            | "generate_yubikey"
            | "activate_yubikey"
            | "activate_yubikey_put"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_is_not_whitelisted_by_route_name() {
        assert!(!is_mandatory_2fa_setup_allowed_route_name("sync"));
    }

    #[test]
    fn sync_is_not_whitelisted_by_path() {
        assert!(!is_mandatory_2fa_setup_allowed_path("/sync"));
        assert!(!is_mandatory_2fa_setup_allowed_path("/api/sync"));
    }

    #[test]
    fn notification_hub_is_not_whitelisted_by_path() {
        assert!(!is_mandatory_2fa_setup_allowed_path("/notifications/hub"));
        assert!(!is_mandatory_2fa_setup_allowed_path("/api/notifications/hub"));
    }

    #[test]
    fn minimal_bootstrap_endpoints_remain_allowed() {
        assert!(is_mandatory_2fa_setup_allowed_route_name("profile"));
        assert!(is_mandatory_2fa_setup_allowed_route_name("revision_date"));
        assert!(is_mandatory_2fa_setup_allowed_path("/accounts/profile"));
        assert!(is_mandatory_2fa_setup_allowed_path("/accounts/revision-date"));
    }

    #[test]
    fn authenticator_enrollment_endpoints_remain_allowed() {
        assert!(is_mandatory_2fa_setup_allowed_route_name("get_twofactor"));
        assert!(is_mandatory_2fa_setup_allowed_route_name("generate_authenticator"));
        assert!(is_mandatory_2fa_setup_allowed_route_name("activate_authenticator"));
        assert!(is_mandatory_2fa_setup_allowed_path("/two-factor"));
        assert!(is_mandatory_2fa_setup_allowed_path("/two-factor/authenticator"));
        assert!(is_mandatory_2fa_setup_allowed_path("/accounts/verify-password"));
        assert!(is_mandatory_2fa_setup_allowed_path("/accounts/request-otp"));
        assert!(is_mandatory_2fa_setup_allowed_path("/accounts/verify-otp"));
        assert!(is_mandatory_2fa_setup_allowed_path("/accounts/set-password"));
        assert!(is_mandatory_2fa_setup_allowed_path("/accounts/keys"));
    }
}
