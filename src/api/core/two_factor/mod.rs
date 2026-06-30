use chrono::{TimeDelta, Utc};
use data_encoding::BASE32;
use num_traits::FromPrimitive;
use rocket::{Route, serde::json::Json};
use serde_json::Value;

use crate::{
    CONFIG,
    api::{
        EmptyResult, JsonResult,
        core::log_event,
    },
    auth::Headers,
    crypto,
    db::{
        DbConn, DbPool,
        models::{
            DeviceType, EventType, Membership, MembershipType, OrgPolicyType, Organization, OrganizationId, TwoFactor,
            TwoFactorIncomplete, TwoFactorType, User, UserId,
        },
    },
    mail,
};

pub mod authenticator;
pub mod duo;
pub mod duo_oidc;
pub mod email;
pub mod protected_actions;
pub mod webauthn;
pub mod yubikey;

/// Only authenticator app 2FA is allowed for user-managed providers in this deployment.
pub fn is_allowed_mandatory_twofactor_provider(provider_type: &TwoFactorType) -> bool {
    matches!(provider_type, TwoFactorType::Authenticator)
}

pub fn is_allowed_mandatory_twofactor_setup(provider_type: &TwoFactorType) -> bool {
    matches!(provider_type, TwoFactorType::Authenticator)
}

pub fn reject_non_authenticator_twofactor_setup() -> EmptyResult {
    err!("Only authenticator app 2FA is allowed")
}

pub fn is_twofactor_provider_usable(provider_type: &TwoFactorType, _provider_data: Option<&str>) -> bool {
    if !is_allowed_mandatory_twofactor_provider(provider_type) {
        return false;
    }

    match provider_type {
        TwoFactorType::Authenticator => true,
        _ => false,
    }
}

pub fn routes() -> Vec<Route> {
    let mut routes = routes![
        get_twofactor,
        get_recover,
        disable_twofactor,
        disable_twofactor_put,
        get_device_verification_settings,
    ];

    routes.append(&mut authenticator::routes());
    routes.append(&mut duo::routes());
    routes.append(&mut email::routes());
    routes.append(&mut webauthn::routes());
    routes.append(&mut yubikey::routes());
    routes.append(&mut protected_actions::routes());

    routes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remember_device_provider_is_not_usable() {
        assert!(!is_allowed_mandatory_twofactor_provider(&TwoFactorType::Remember));
        assert!(!is_twofactor_provider_usable(&TwoFactorType::Remember, None));
    }

    #[test]
    fn authenticator_provider_remains_usable() {
        assert!(is_allowed_mandatory_twofactor_provider(&TwoFactorType::Authenticator));
        assert!(is_twofactor_provider_usable(&TwoFactorType::Authenticator, None));
    }
}

#[get("/two-factor")]
async fn get_twofactor(headers: Headers, conn: DbConn) -> Json<Value> {
    let twofactors = TwoFactor::find_by_user(&headers.user.uuid, &conn).await;
    let twofactors_json: Vec<Value> = twofactors
        .iter()
        .filter_map(|tf| {
            let provider_type = TwoFactorType::from_i32(tf.atype)?;
            (is_allowed_mandatory_twofactor_setup(&provider_type)
                && is_twofactor_provider_usable(&provider_type, Some(&tf.data)))
            .then(|| TwoFactor::to_json_provider(tf))
        })
        .collect();

    Json(json!({
        "data": twofactors_json,
        "object": "list",
        "continuationToken": null,
    }))
}

#[post("/two-factor/get-recover", data = "<data>")]
async fn get_recover(data: Json<Value>, _headers: Headers, _conn: DbConn) -> JsonResult {
    drop(data);
    err!("Only authenticator app 2FA is allowed")
}

async fn generate_recover_code(user: &mut User, conn: &DbConn) {
    if user.totp_recover.is_none() {
        let totp_recover = crypto::encode_random_bytes::<20>(&BASE32);
        user.totp_recover = Some(totp_recover);
        user.save(conn).await.ok();
    }
}

#[post("/two-factor/disable", data = "<data>")]
async fn disable_twofactor(data: Json<Value>, _headers: Headers, _conn: DbConn) -> JsonResult {
    drop(data);
    err!("Only authenticator app 2FA is allowed")
}

#[put("/two-factor/disable", data = "<data>")]
async fn disable_twofactor_put(data: Json<Value>, headers: Headers, conn: DbConn) -> JsonResult {
    disable_twofactor(data, headers, conn).await
}

pub async fn enforce_2fa_policy(
    user: &User,
    act_user_id: &UserId,
    device_type: i32,
    ip: &std::net::IpAddr,
    conn: &DbConn,
) -> EmptyResult {
    for member in Membership::find_by_user_and_policy(&user.uuid, OrgPolicyType::TwoFactorAuthentication, conn).await {
        // Policy only applies to non-Owner/non-Admin members who have accepted joining the org
        if member.atype < MembershipType::Admin {
            if CONFIG.mail_enabled() {
                let org = Organization::find_by_uuid(&member.org_uuid, conn).await.unwrap();
                mail::send_2fa_removed_from_org(&user.email, &org.name).await?;
            }
            let mut member = member;
            member.revoke();
            member.save(conn).await?;

            log_event(
                EventType::OrganizationUserRevoked as i32,
                &member.uuid,
                &member.org_uuid,
                act_user_id,
                device_type,
                ip,
                conn,
            )
            .await;
        }
    }

    Ok(())
}

pub async fn enforce_2fa_policy_for_org(
    org_id: &OrganizationId,
    act_user_id: &UserId,
    device_type: i32,
    ip: &std::net::IpAddr,
    conn: &DbConn,
) -> EmptyResult {
    let org = Organization::find_by_uuid(org_id, conn).await.unwrap();
    for member in Membership::find_confirmed_by_org(org_id, conn).await {
        // Don't enforce the policy for Admins and Owners.
        if member.atype < MembershipType::Admin && TwoFactor::find_by_user(&member.user_uuid, conn).await.is_empty() {
            if CONFIG.mail_enabled() {
                let user = User::find_by_uuid(&member.user_uuid, conn).await.unwrap();
                mail::send_2fa_removed_from_org(&user.email, &org.name).await?;
            }
            let mut member = member;
            member.revoke();
            member.save(conn).await?;

            log_event(
                EventType::OrganizationUserRevoked as i32,
                &member.uuid,
                org_id,
                act_user_id,
                device_type,
                ip,
                conn,
            )
            .await;
        }
    }

    Ok(())
}

pub async fn send_incomplete_2fa_notifications(pool: DbPool) {
    debug!("Sending notifications for incomplete 2FA logins");

    if CONFIG.incomplete_2fa_time_limit() <= 0 || !CONFIG.mail_enabled() {
        return;
    }

    let Ok(conn) = pool.get().await else {
        error!("Failed to get DB connection in send_incomplete_2fa_notifications()");
        return;
    };

    let now = Utc::now().naive_utc();
    let time_limit = TimeDelta::try_minutes(CONFIG.incomplete_2fa_time_limit()).unwrap();
    let time_before = now - time_limit;
    let incomplete_logins = TwoFactorIncomplete::find_logins_before(&time_before, &conn).await;
    for login in incomplete_logins {
        let user = User::find_by_uuid(&login.user_uuid, &conn).await.expect("User not found");
        info!(
            "User {} did not complete a 2FA login within the configured time limit. IP: {}",
            user.email, login.ip_address
        );
        match mail::send_incomplete_2fa_login(
            &user.email,
            &login.ip_address,
            &login.login_time,
            &login.device_name,
            &DeviceType::from_i32(login.device_type).to_string(),
        )
        .await
        {
            Ok(()) => {
                if let Err(e) = login.delete(&conn).await {
                    error!("Error deleting incomplete 2FA record: {e:#?}");
                }
            }
            Err(e) => {
                error!("Error sending incomplete 2FA email: {e:#?}");
            }
        }
    }
}

// This function currently is just a dummy and the actual part is not implemented yet.
// This also prevents 404 errors.
//
// See the following Bitwarden PR's regarding this feature.
// https://github.com/bitwarden/clients/pull/2843
// https://github.com/bitwarden/clients/pull/2839
// https://github.com/bitwarden/server/pull/2016
//
// Device verification settings are not used in this deployment.
#[get("/two-factor/get-device-verification-settings")]
fn get_device_verification_settings(_headers: Headers, _conn: DbConn) -> Json<Value> {
    Json(json!({
        "isDeviceVerificationSectionEnabled":false,
        "unknownDeviceVerificationEnabled":false,
        "object":"deviceVerificationSettings"
    }))
}
