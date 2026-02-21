use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::{Deserialize, Serialize};

use base64::Engine;

use alloy_db::sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    Set,
};
use sea_orm::prelude::Expr;
use sea_orm::prelude::Uuid;

use crate::request_meta::RequestMeta;
use crate::state::AppState;

pub const CSRF_COOKIE_NAME: &str = "csrf";
pub const ACCESS_COOKIE_NAME: &str = "access";
const REFRESH_COOKIE_NAME: &str = "refresh";

#[derive(Debug, Serialize)]
pub struct AuthErrorBody {
    pub code: String,
    pub message: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_seconds: Option<i64>,
}

const SESSION_RISK_WINDOW_SECONDS: i64 = 30 * 24 * 60 * 60;
const LOGIN_RISK_WINDOW_SECONDS: i64 = 15 * 60;

fn default_auth_error_code(status: StatusCode) -> &'static str {
    match status {
        StatusCode::BAD_REQUEST => "bad_request",
        StatusCode::UNAUTHORIZED => "unauthorized",
        StatusCode::FORBIDDEN => "forbidden",
        StatusCode::CONFLICT => "conflict",
        StatusCode::INTERNAL_SERVER_ERROR => "internal_error",
        _ => "auth_error",
    }
}

fn parse_bool_flag(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn env_bool_flag(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .as_deref()
        .and_then(parse_bool_flag)
        .unwrap_or(default)
}

fn secure_cookies_enabled() -> bool {
    env_bool_flag("ALLOY_COOKIE_SECURE", true)
}

fn required_env_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn auth_error_response(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
) -> Response {
    auth_error_response_with_context(status, code, message, "auth", None, None, None)
}

pub fn auth_error_response_with_context(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
    source: impl Into<String>,
    request_id: Option<String>,
    reason: Option<String>,
    window_seconds: Option<i64>,
) -> Response {
    (
        status,
        Json(AuthErrorBody {
            code: code.into(),
            message: message.into(),
            source: source.into(),
            request_id,
            reason,
            window_seconds,
        }),
    )
        .into_response()
}

fn json_error_code_with_meta(
    meta: &RequestMeta,
    status: StatusCode,
    error_code: &'static str,
    message: impl Into<String>,
    source: &'static str,
    window_seconds: Option<i64>,
) -> Response {
    auth_error_response_with_context(
        status,
        error_code,
        message,
        source,
        Some(meta.request_id.clone()),
        Some(error_code.to_string()),
        window_seconds,
    )
}

fn json_error_with_meta(
    meta: &RequestMeta,
    status: StatusCode,
    message: impl Into<String>,
) -> Response {
    auth_error_response_with_context(
        status,
        default_auth_error_code(status),
        message,
        "auth",
        Some(meta.request_id.clone()),
        None,
        None,
    )
}

fn audit_security_event(
    reason: &'static str,
    source: &'static str,
    window_seconds: Option<i64>,
    user_id: Option<Uuid>,
) {
    let at_unix_ms = chrono::Utc::now().timestamp_millis();
    tracing::warn!(
        reason,
        source,
        window_seconds,
        user_id = ?user_id,
        at_unix_ms,
        "security event"
    );
}

fn cookie_base(name: &'static str, value: String, path: &'static str) -> Cookie<'static> {
    let mut c = Cookie::new(name, value);
    c.set_http_only(true);
    c.set_same_site(SameSite::Lax);
    c.set_path(path);
    c.set_secure(secure_cookies_enabled());
    c
}

fn random_token(n: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    // URL-safe base64 without padding.
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn csrf_cookie(value: String) -> Cookie<'static> {
    // Non-HttpOnly so the browser app can read and send it as a header.
    let mut c = Cookie::new(CSRF_COOKIE_NAME, value);
    c.set_http_only(false);
    c.set_same_site(SameSite::Lax);
    c.set_path("/");
    c.set_secure(secure_cookies_enabled());
    c
}

fn clear_cookie(name: &'static str, path: &'static str) -> Cookie<'static> {
    let mut c = Cookie::new(name, "");
    c.set_path(path);
    c.set_secure(secure_cookies_enabled());
    c.make_removal();
    c
}

#[derive(Debug, Serialize)]
pub struct CsrfResponse {
    pub token: String,
}

pub async fn csrf(jar: CookieJar) -> impl IntoResponse {
    let token = random_token(32);
    let jar = jar.add(csrf_cookie(token.clone()));
    (jar, Json(CsrfResponse { token }))
}

// NOTE: CSRF is enforced in middleware (see `crate::security`).

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangeCredentialsRequest {
    pub current_password: String,
    pub new_username: Option<String>,
    pub new_password: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WhoamiResponse {
    pub user_id: String,
    pub username: String,
    pub is_admin: bool,
}

fn hash_refresh_token(raw: &str) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(raw.as_bytes());
    let out = hasher.finalize();
    hex::encode(out)
}

fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    use argon2::password_hash::{PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut rand::rngs::OsRng);
    let argon2 = argon2::Argon2::default();
    Ok(argon2
        .hash_password(password.as_bytes(), &salt)?
        .to_string())
}

fn verify_password(hash: &str, password: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    let argon2 = argon2::Argon2::default();
    argon2.verify_password(password.as_bytes(), &parsed).is_ok()
}

pub fn ensure_jwt_secret_configured() -> anyhow::Result<()> {
    let _ = jwt_secret()?;
    Ok(())
}

pub async fn bootstrap_initial_admin(db: &DatabaseConnection) -> anyhow::Result<()> {
    let existing_user_count = alloy_db::entities::users::Entity::find()
        .count(db)
        .await
        .map_err(|e| anyhow::anyhow!("db error: {e}"))?;
    if existing_user_count > 0 {
        return Ok(());
    }

    let username = required_env_non_empty("ALLOY_ADMIN_USER")
        .ok_or_else(|| anyhow::anyhow!("ALLOY_ADMIN_USER is required when no users exist"))?;
    let password = required_env_non_empty("ALLOY_ADMIN_PASS")
        .ok_or_else(|| anyhow::anyhow!("ALLOY_ADMIN_PASS is required when no users exist"))?;

    let ph = hash_password(&password)
        .map_err(|e| anyhow::anyhow!("failed to hash ALLOY_ADMIN_PASS: {e}"))?;
    let model = alloy_db::entities::users::ActiveModel {
        id: Set(Uuid::new_v4()),
        username: Set(username),
        password_hash: Set(ph),
        is_admin: Set(true),
        created_at: Set(chrono::Utc::now().into()),
    };

    alloy_db::entities::users::Entity::insert(model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::column(alloy_db::entities::users::Column::Username)
                .do_nothing()
                .to_owned(),
        )
        .exec(db)
        .await
        .map_err(|e| anyhow::anyhow!("db error: {e}"))?;
    Ok(())
}

fn build_access_cookie(jwt: String) -> Cookie<'static> {
    // Access token is used by both the API layer and `/auth/whoami`, so it must
    // be available on all paths.
    let mut c = cookie_base(ACCESS_COOKIE_NAME, jwt, "/");
    c.set_same_site(SameSite::Lax);
    c
}

fn build_refresh_cookie(refresh: String) -> Cookie<'static> {
    let mut c = cookie_base(REFRESH_COOKIE_NAME, refresh, "/auth/refresh");
    c.set_same_site(SameSite::Strict);
    c
}

fn jwt_secret() -> anyhow::Result<Vec<u8>> {
    let secret = required_env_non_empty("ALLOY_JWT_SECRET")
        .ok_or_else(|| anyhow::anyhow!("ALLOY_JWT_SECRET is required and cannot be empty"))?;
    Ok(secret.into_bytes())
}

fn is_read_only() -> bool {
    matches!(
        std::env::var("ALLOY_READ_ONLY")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    username: String,
    is_admin: bool,
    exp: usize,
    iat: usize,
    iss: String,
    aud: String,
}

pub fn validate_access_jwt(token: &str) -> anyhow::Result<WhoamiResponse> {
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.set_audience(&["alloy-web"]);
    validation.set_issuer(&["alloy"]);

    let data = jsonwebtoken::decode::<Claims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(&jwt_secret()?),
        &validation,
    )?;

    Ok(WhoamiResponse {
        user_id: data.claims.sub,
        username: data.claims.username,
        is_admin: data.claims.is_admin,
    })
}

fn make_access_jwt(user: &alloy_db::entities::users::Model) -> anyhow::Result<String> {
    let now = time::OffsetDateTime::now_utc();
    let exp = (now + time::Duration::minutes(5)).unix_timestamp() as usize;
    let iat = now.unix_timestamp() as usize;

    let claims = Claims {
        sub: user.id.to_string(),
        username: user.username.clone(),
        is_admin: user.is_admin,
        exp,
        iat,
        iss: "alloy".to_string(),
        aud: "alloy-web".to_string(),
    };

    Ok(jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(&jwt_secret()?),
    )?)
}

pub async fn login(
    State(state): State<AppState>,
    axum::extract::Extension(meta): axum::extract::Extension<RequestMeta>,
    jar: CookieJar,
    Json(input): Json<LoginRequest>,
) -> impl IntoResponse {
    let username = input.username.trim().to_string();
    if username.is_empty() || input.password.is_empty() {
        audit_security_event(
            "login_input_invalid",
            "auth.login",
            Some(LOGIN_RISK_WINDOW_SECONDS),
            None,
        );
        let ctx = crate::rpc::Ctx {
            db: state.db.clone(),
            agent_hub: state.agent_hub.clone(),
            user: None,
            request_id: meta.request_id.clone(),
        };
        crate::audit::record_auth_failure(
            &ctx,
            "auth.login.failed",
            "auth",
            "login_input_invalid",
            "auth.login",
            Some(LOGIN_RISK_WINDOW_SECONDS),
            &meta,
        )
        .await;
        return json_error_code_with_meta(
            &meta,
            StatusCode::BAD_REQUEST,
            "login_input_invalid",
            "username and password are required",
            "auth.login",
            Some(LOGIN_RISK_WINDOW_SECONDS),
        )
        .into_response();
    }

    let db = &*state.db;
    let user = match alloy_db::entities::users::Entity::find()
        .filter(alloy_db::entities::users::Column::Username.eq(username))
        .one(db)
        .await
    {
        Ok(Some(u)) => u,
        Ok(None) => {
            audit_security_event(
                "login_invalid_credentials",
                "auth.login",
                Some(LOGIN_RISK_WINDOW_SECONDS),
                None,
            );
            let ctx = crate::rpc::Ctx {
                db: state.db.clone(),
                agent_hub: state.agent_hub.clone(),
                user: None,
                request_id: meta.request_id.clone(),
            };
            crate::audit::record_auth_failure(
                &ctx,
                "auth.login.failed",
                "auth",
                "login_invalid_credentials",
                "auth.login",
                Some(LOGIN_RISK_WINDOW_SECONDS),
                &meta,
            )
            .await;
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "invalid credentials")
                .into_response();
        }
        Err(e) => {
            return json_error_with_meta(&meta, StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
                .into_response();
        }
    };

    if !verify_password(&user.password_hash, &input.password) {
        audit_security_event(
            "login_invalid_credentials",
            "auth.login",
            Some(LOGIN_RISK_WINDOW_SECONDS),
            Some(user.id),
        );
        let ctx = crate::rpc::Ctx {
            db: state.db.clone(),
            agent_hub: state.agent_hub.clone(),
            user: Some(crate::rpc::AuthUser {
                user_id: user.id.to_string(),
                username: user.username.clone(),
                is_admin: user.is_admin,
            }),
            request_id: meta.request_id.clone(),
        };
        crate::audit::record_auth_failure(
            &ctx,
            "auth.login.failed",
            "auth",
            "login_invalid_credentials",
            "auth.login",
            Some(LOGIN_RISK_WINDOW_SECONDS),
            &meta,
        )
        .await;
        return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "invalid credentials")
            .into_response();
    }

    let access = match make_access_jwt(&user) {
        Ok(v) => v,
        Err(e) => {
            return json_error_with_meta(&meta, StatusCode::INTERNAL_SERVER_ERROR, format!("jwt error: {e}"))
                .into_response();
        }
    };

    let refresh_raw = random_token(32);
    let refresh_hash = hash_refresh_token(&refresh_raw);
    let expires_at = chrono::Utc::now() + chrono::Duration::days(30);

    let token = alloy_db::entities::refresh_tokens::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(user.id),
        token_hash: Set(refresh_hash),
        created_at: Set(chrono::Utc::now().into()),
        expires_at: Set(expires_at.into()),
        revoked_at: Set(None),
        rotated_at: Set(None),
    };
    if let Err(e) = alloy_db::entities::refresh_tokens::Entity::insert(token)
        .exec(db)
        .await
    {
        return json_error_with_meta(&meta, StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
            .into_response();
    }

    let jar = jar
        .add(build_access_cookie(access))
        .add(build_refresh_cookie(refresh_raw));

    (
        jar,
        Json(WhoamiResponse {
            user_id: user.id.to_string(),
            username: user.username,
            is_admin: user.is_admin,
        }),
    )
        .into_response()
}

pub async fn whoami(
    State(_state): State<AppState>,
    axum::extract::Extension(meta): axum::extract::Extension<RequestMeta>,
    jar: CookieJar,
) -> impl IntoResponse {
    let token = match jar.get(ACCESS_COOKIE_NAME) {
        Some(c) => c.value().to_string(),
        None => {
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "missing access token")
                .into_response();
        }
    };

    match validate_access_jwt(&token) {
        Ok(me) => (StatusCode::OK, Json(me)).into_response(),
        Err(_) => json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "invalid access token")
            .into_response(),
    }
}

pub async fn change_credentials(
    State(state): State<AppState>,
    axum::extract::Extension(meta): axum::extract::Extension<RequestMeta>,
    jar: CookieJar,
    Json(input): Json<ChangeCredentialsRequest>,
) -> impl IntoResponse {
    if is_read_only() {
        return json_error_with_meta(&meta, StatusCode::FORBIDDEN, "control is in read-only mode")
            .into_response();
    }

    let token = match jar.get(ACCESS_COOKIE_NAME) {
        Some(c) => c.value().to_string(),
        None => {
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "missing access token")
                .into_response();
        }
    };

    let me = match validate_access_jwt(&token) {
        Ok(me) => me,
        Err(_) => {
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "invalid access token")
                .into_response();
        }
    };

    let current_password = input.current_password;
    if current_password.trim().is_empty() {
        return json_error_with_meta(&meta, StatusCode::BAD_REQUEST, "current password is required")
            .into_response();
    }

    let next_username = input
        .new_username
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let next_password = input.new_password.filter(|v| !v.is_empty());

    if next_username.is_none() && next_password.is_none() {
        return json_error_with_meta(
            &meta,
            StatusCode::BAD_REQUEST,
            "new username or password is required",
        )
        .into_response();
    }

    let user_id = match Uuid::parse_str(&me.user_id) {
        Ok(v) => v,
        Err(_) => {
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "invalid access token")
                .into_response();
        }
    };

    let db = &*state.db;
    let user = match alloy_db::entities::users::Entity::find_by_id(user_id)
        .one(db)
        .await
    {
        Ok(Some(u)) => u,
        Ok(None) => {
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "user not found")
                .into_response();
        }
        Err(e) => {
            return json_error_with_meta(&meta, StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
                .into_response();
        }
    };

    if !verify_password(&user.password_hash, &current_password) {
        return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "invalid current password")
            .into_response();
    }

    let mut active: alloy_db::entities::users::ActiveModel = user.clone().into();
    let mut changed = false;

    if let Some(username) = next_username {
        if username != user.username {
            let exists = match alloy_db::entities::users::Entity::find()
                .filter(alloy_db::entities::users::Column::Username.eq(username.clone()))
                .filter(alloy_db::entities::users::Column::Id.ne(user.id))
                .one(db)
                .await
            {
                Ok(v) => v.is_some(),
                Err(e) => {
                    return json_error_with_meta(&meta, StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
                        .into_response();
                }
            };

            if exists {
                return json_error_with_meta(&meta, StatusCode::CONFLICT, "username already exists")
                    .into_response();
            }

            active.username = Set(username);
            changed = true;
        }
    }

    if let Some(password) = next_password {
        let hash = match hash_password(&password) {
            Ok(v) => v,
            Err(e) => {
                return json_error_with_meta(
                    &meta,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("hash error: {e}"),
                )
                .into_response();
            }
        };
        active.password_hash = Set(hash);
        changed = true;
    }

    if !changed {
        return json_error_with_meta(
            &meta,
            StatusCode::BAD_REQUEST,
            "no credential changes detected",
        )
        .into_response();
    }

    let updated = match active.update(db).await {
        Ok(v) => v,
        Err(e) => {
            let message = e.to_string();
            if message.contains("idx_users_username_unique")
                || message.contains("UNIQUE constraint failed: users.username")
            {
                return json_error_with_meta(&meta, StatusCode::CONFLICT, "username already exists")
                    .into_response();
            }
            return json_error_with_meta(&meta, StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
                .into_response();
        }
    };

    let access = match make_access_jwt(&updated) {
        Ok(v) => v,
        Err(e) => {
            return json_error_with_meta(&meta, StatusCode::INTERNAL_SERVER_ERROR, format!("jwt error: {e}"))
                .into_response();
        }
    };

    let jar = jar.add(build_access_cookie(access));

    (
        jar,
        Json(WhoamiResponse {
            user_id: updated.id.to_string(),
            username: updated.username,
            is_admin: updated.is_admin,
        }),
    )
        .into_response()
}

pub async fn logout(State(state): State<AppState>, jar: CookieJar) -> impl IntoResponse {
    let db = &*state.db;
    if let Some(refresh) = jar.get(REFRESH_COOKIE_NAME) {
        let h = hash_refresh_token(refresh.value());
        let _ = alloy_db::entities::refresh_tokens::Entity::update_many()
            .col_expr(
                alloy_db::entities::refresh_tokens::Column::RevokedAt,
                Expr::value(chrono::Utc::now()),
            )
            .filter(alloy_db::entities::refresh_tokens::Column::TokenHash.eq(h))
            .exec(db)
            .await;
    }

    let jar = jar
        .remove(clear_cookie(ACCESS_COOKIE_NAME, "/"))
        .remove(clear_cookie(REFRESH_COOKIE_NAME, "/auth/refresh"));
    (jar, StatusCode::NO_CONTENT).into_response()
}

pub async fn refresh(
    State(state): State<AppState>,
    axum::extract::Extension(meta): axum::extract::Extension<RequestMeta>,
    jar: CookieJar,
) -> impl IntoResponse {
    let db = &*state.db;
    let refresh_cookie = match jar.get(REFRESH_COOKIE_NAME) {
        Some(c) => c.value().to_string(),
        None => {
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "missing refresh token")
                .into_response();
        }
    };
    let h = hash_refresh_token(&refresh_cookie);

    // Strict single-use refresh: mark rotated and issue a new token.
    let token = match alloy_db::entities::refresh_tokens::Entity::find()
        .filter(alloy_db::entities::refresh_tokens::Column::TokenHash.eq(h.clone()))
        .one(db)
        .await
    {
        Ok(Some(t)) => t,
        Ok(None) => {
            audit_security_event(
                "refresh_token_not_found",
                "auth.refresh",
                Some(SESSION_RISK_WINDOW_SECONDS),
                None,
            );
            let ctx = crate::rpc::Ctx {
                db: state.db.clone(),
                agent_hub: state.agent_hub.clone(),
                user: None,
                request_id: meta.request_id.clone(),
            };
            crate::audit::record_auth_failure(
                &ctx,
                "auth.refresh.failed",
                "auth",
                "refresh_token_invalid",
                "auth.refresh",
                Some(SESSION_RISK_WINDOW_SECONDS),
                &meta,
            )
            .await;
            return json_error_code_with_meta(
                &meta,
                StatusCode::UNAUTHORIZED,
                "refresh_token_invalid",
                "invalid refresh token",
                "auth.refresh",
                Some(SESSION_RISK_WINDOW_SECONDS),
            )
            .into_response();
        }
        Err(e) => {
            return json_error_with_meta(
                &meta,
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("db error: {e}"),
            )
            .into_response();
        }
    };

    if token.revoked_at.is_some() {
        audit_security_event(
            "refresh_token_revoked",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
            Some(token.user_id),
        );
        let ctx = crate::rpc::Ctx {
            db: state.db.clone(),
            agent_hub: state.agent_hub.clone(),
            user: Some(crate::rpc::AuthUser {
                user_id: token.user_id.to_string(),
                username: String::new(),
                is_admin: false,
            }),
            request_id: meta.request_id.clone(),
        };
        crate::audit::record_auth_failure(
            &ctx,
            "auth.refresh.failed",
            "auth",
            "refresh_token_revoked",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
            &meta,
        )
        .await;
        return json_error_code_with_meta(
            &meta,
            StatusCode::UNAUTHORIZED,
            "refresh_token_revoked",
            "refresh token revoked",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
        )
        .into_response();
    }
    if token.rotated_at.is_some() {
        let now = chrono::Utc::now();
        if let Err(e) = alloy_db::entities::refresh_tokens::Entity::update_many()
            .col_expr(
                alloy_db::entities::refresh_tokens::Column::RevokedAt,
                Expr::value(now),
            )
            .filter(alloy_db::entities::refresh_tokens::Column::UserId.eq(token.user_id))
            .filter(alloy_db::entities::refresh_tokens::Column::RevokedAt.is_null())
            .exec(db)
            .await
        {
            return json_error_with_meta(
                &meta,
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("db error: {e}"),
            )
            .into_response();
        }

        audit_security_event(
            "refresh_token_reuse_detected",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
            Some(token.user_id),
        );

        audit_security_event(
            "refresh_token_reuse_forced_invalidation",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
            Some(token.user_id),
        );

        let ctx = crate::rpc::Ctx {
            db: state.db.clone(),
            agent_hub: state.agent_hub.clone(),
            user: Some(crate::rpc::AuthUser {
                user_id: token.user_id.to_string(),
                username: String::new(),
                is_admin: false,
            }),
            request_id: meta.request_id.clone(),
        };
        crate::audit::record_auth_failure(
            &ctx,
            "auth.refresh.failed",
            "auth",
            "refresh_token_reuse_detected",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
            &meta,
        )
        .await;

        let jar = jar
            .remove(clear_cookie(ACCESS_COOKIE_NAME, "/"))
            .remove(clear_cookie(REFRESH_COOKIE_NAME, "/auth/refresh"));
        return (
            jar,
            json_error_code_with_meta(
                &meta,
                StatusCode::UNAUTHORIZED,
                "refresh_token_reuse_detected",
                "refresh token reuse detected; all sessions invalidated",
                "auth.refresh",
                Some(SESSION_RISK_WINDOW_SECONDS),
            ),
        )
            .into_response();
    }
    if token.expires_at < chrono::Utc::now().fixed_offset() {
        audit_security_event(
            "refresh_token_expired",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
            Some(token.user_id),
        );
        let ctx = crate::rpc::Ctx {
            db: state.db.clone(),
            agent_hub: state.agent_hub.clone(),
            user: Some(crate::rpc::AuthUser {
                user_id: token.user_id.to_string(),
                username: String::new(),
                is_admin: false,
            }),
            request_id: meta.request_id.clone(),
        };
        crate::audit::record_auth_failure(
            &ctx,
            "auth.refresh.failed",
            "auth",
            "refresh_token_expired",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
            &meta,
        )
        .await;
        return json_error_code_with_meta(
            &meta,
            StatusCode::UNAUTHORIZED,
            "refresh_token_expired",
            "refresh token expired",
            "auth.refresh",
            Some(SESSION_RISK_WINDOW_SECONDS),
        )
        .into_response();
    }

    // Rotate.
    let user_id = token.user_id;
    let mut active: alloy_db::entities::refresh_tokens::ActiveModel = token.into();
    active.rotated_at = Set(Some(chrono::Utc::now().into()));
    if let Err(e) = active.update(db).await {
        return json_error_with_meta(
            &meta,
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {e}"),
        )
        .into_response();
    }

    let user = match alloy_db::entities::users::Entity::find_by_id(user_id)
        .one(db)
        .await
    {
        Ok(Some(u)) => u,
        _ => {
            return json_error_with_meta(&meta, StatusCode::UNAUTHORIZED, "user not found")
                .into_response();
        }
    };

    let access = match make_access_jwt(&user) {
        Ok(v) => v,
        Err(e) => {
            return json_error_with_meta(
                &meta,
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("jwt error: {e}"),
            )
            .into_response();
        }
    };

    let refresh_raw = random_token(32);
    let refresh_hash = hash_refresh_token(&refresh_raw);
    let expires_at = chrono::Utc::now() + chrono::Duration::days(30);
    let new_token = alloy_db::entities::refresh_tokens::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(user.id),
        token_hash: Set(refresh_hash),
        created_at: Set(chrono::Utc::now().into()),
        expires_at: Set(expires_at.into()),
        revoked_at: Set(None),
        rotated_at: Set(None),
    };
    if let Err(e) = alloy_db::entities::refresh_tokens::Entity::insert(new_token)
        .exec(db)
        .await
    {
        return json_error_with_meta(
            &meta,
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {e}"),
        )
        .into_response();
    }

    let jar = jar
        .add(build_access_cookie(access))
        .add(build_refresh_cookie(refresh_raw));

    (jar, StatusCode::NO_CONTENT).into_response()
}
