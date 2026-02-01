use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::{Deserialize, Serialize};

use base64::Engine;

use alloy_db::sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use sea_orm::prelude::Expr;
use sea_orm::prelude::Uuid;

use crate::state::AppState;

pub const CSRF_COOKIE_NAME: &str = "csrf";
pub const ACCESS_COOKIE_NAME: &str = "access";
const REFRESH_COOKIE_NAME: &str = "refresh";

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub message: String,
}

fn json_error(code: StatusCode, message: impl Into<String>) -> impl IntoResponse {
    (code, Json(ErrorBody { message: message.into() }))
}

fn cookie_base(name: &'static str, value: String, path: &'static str) -> Cookie<'static> {
    let mut c = Cookie::new(name, value);
    c.set_http_only(true);
    c.set_same_site(SameSite::Lax);
    c.set_path(path);
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
    c
}

fn clear_cookie(name: &'static str, path: &'static str) -> Cookie<'static> {
    let mut c = Cookie::new(name, "");
    c.set_path(path);
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
    Ok(argon2.hash_password(password.as_bytes(), &salt)?.to_string())
}

fn verify_password(hash: &str, password: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    let parsed = PasswordHash::new(hash);
    if parsed.is_err() {
        return false;
    }
    let argon2 = argon2::Argon2::default();
    argon2
        .verify_password(password.as_bytes(), &parsed.unwrap())
        .is_ok()
}

async fn ensure_admin_user(db: &DatabaseConnection) -> Result<(), String> {
    let username = std::env::var("ALLOY_ADMIN_USER").unwrap_or_else(|_| "admin".to_string());
    let password = std::env::var("ALLOY_ADMIN_PASS").unwrap_or_else(|_| "admin".to_string());

    let existing = alloy_db::entities::users::Entity::find()
        .filter(alloy_db::entities::users::Column::Username.eq(username.clone()))
        .one(db)
        .await
        .map_err(|e| format!("db error: {e}"))?;
    if existing.is_some() {
        return Ok(());
    }

    let ph = hash_password(&password).map_err(|e| format!("hash error: {e}"))?;
    let model = alloy_db::entities::users::ActiveModel {
        id: Set(Uuid::new_v4()),
        username: Set(username),
        password_hash: Set(ph),
        is_admin: Set(true),
        created_at: Set(chrono::Utc::now().into()),
    };

    alloy_db::entities::users::Entity::insert(model)
        .exec(db)
        .await
        .map_err(|e| format!("db error: {e}"))?;
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

fn jwt_secret() -> Vec<u8> {
    std::env::var("ALLOY_JWT_SECRET")
        .unwrap_or_else(|_| "dev-insecure-change-me".to_string())
        .into_bytes()
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
        &jsonwebtoken::DecodingKey::from_secret(&jwt_secret()),
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
        &jsonwebtoken::EncodingKey::from_secret(&jwt_secret()),
    )?)
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(input): Json<LoginRequest>,
) -> impl IntoResponse {
    let db = &*state.db;
    if let Err(e) = ensure_admin_user(db).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("bootstrap failed: {e}"))
            .into_response();
    }

    let user = match alloy_db::entities::users::Entity::find()
        .filter(alloy_db::entities::users::Column::Username.eq(input.username.clone()))
        .one(db)
        .await
    {
        Ok(Some(u)) => u,
        Ok(None) => return json_error(StatusCode::UNAUTHORIZED, "invalid credentials").into_response(),
        Err(e) => {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
                .into_response()
        }
    };

    if !verify_password(&user.password_hash, &input.password) {
        return json_error(StatusCode::UNAUTHORIZED, "invalid credentials").into_response();
    }

    let access = match make_access_jwt(&user) {
        Ok(v) => v,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("jwt error: {e}"))
            .into_response(),
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
    if let Err(e) = alloy_db::entities::refresh_tokens::Entity::insert(token).exec(db).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
            .into_response();
    }

    let jar = jar
        .add(build_access_cookie(access))
        .add(build_refresh_cookie(refresh_raw));

    (jar, Json(WhoamiResponse {
        user_id: user.id.to_string(),
        username: user.username,
        is_admin: user.is_admin,
    }))
        .into_response()
}

pub async fn whoami(State(_state): State<AppState>, jar: CookieJar) -> impl IntoResponse {
    let token = match jar.get(ACCESS_COOKIE_NAME) {
        Some(c) => c.value().to_string(),
        None => return json_error(StatusCode::UNAUTHORIZED, "missing access token").into_response(),
    };

    match validate_access_jwt(&token) {
        Ok(me) => (StatusCode::OK, Json(me)).into_response(),
        Err(_) => json_error(StatusCode::UNAUTHORIZED, "invalid access token").into_response(),
    }
}

pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> impl IntoResponse {
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
    jar: CookieJar,
) -> impl IntoResponse {
    let db = &*state.db;
    let refresh_cookie = match jar.get(REFRESH_COOKIE_NAME) {
        Some(c) => c.value().to_string(),
        None => return json_error(StatusCode::UNAUTHORIZED, "missing refresh token").into_response(),
    };
    let h = hash_refresh_token(&refresh_cookie);

    // Strict single-use refresh: mark rotated and issue a new token.
    let token = match alloy_db::entities::refresh_tokens::Entity::find()
        .filter(alloy_db::entities::refresh_tokens::Column::TokenHash.eq(h.clone()))
        .one(db)
        .await
    {
        Ok(Some(t)) => t,
        Ok(None) => return json_error(StatusCode::UNAUTHORIZED, "invalid refresh token").into_response(),
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
            .into_response(),
    };

    if token.revoked_at.is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "refresh token revoked").into_response();
    }
    if token.rotated_at.is_some() {
        // Reuse detection: fail hard for now.
        return json_error(StatusCode::UNAUTHORIZED, "refresh token already used").into_response();
    }
    if token.expires_at < chrono::Utc::now().fixed_offset() {
        return json_error(StatusCode::UNAUTHORIZED, "refresh token expired").into_response();
    }

    // Rotate.
    let user_id = token.user_id;
    let mut active: alloy_db::entities::refresh_tokens::ActiveModel = token.into();
    active.rotated_at = Set(Some(chrono::Utc::now().into()));
    if let Err(e) = active.update(db).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
            .into_response();
    }

    let user = match alloy_db::entities::users::Entity::find_by_id(user_id)
        .one(db)
        .await
    {
        Ok(Some(u)) => u,
        _ => return json_error(StatusCode::UNAUTHORIZED, "user not found").into_response(),
    };

    let access = match make_access_jwt(&user) {
        Ok(v) => v,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("jwt error: {e}"))
            .into_response(),
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
    if let Err(e) = alloy_db::entities::refresh_tokens::Entity::insert(new_token).exec(db).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
            .into_response();
    }

    let jar = jar
        .add(build_access_cookie(access))
        .add(build_refresh_cookie(refresh_raw));

    (jar, StatusCode::NO_CONTENT).into_response()
}
