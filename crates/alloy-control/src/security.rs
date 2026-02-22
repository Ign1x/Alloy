use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, Request, StatusCode},
    middleware::Next,
    response::Response,
};
use axum_extra::extract::cookie::CookieJar;
use rand::RngCore;
use tracing::Instrument;

use crate::auth::{
    ACCESS_COOKIE_NAME, CSRF_COOKIE_NAME, auth_error_response_with_context, validate_access_jwt,
};
use crate::request_meta::RequestMeta;
use crate::rpc::AuthUser;

const CSRF_HEADER_NAME: &str = "x-csrf-token";

fn json_auth_error(
    request_id: Option<&str>,
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> Response {
    auth_error_response_with_context(
        status,
        code,
        message,
        "security.middleware",
        request_id.map(|v| v.to_string()),
        Some(code.to_string()),
        None,
    )
}

fn is_unsafe_method(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

fn parse_allowed_origins() -> Vec<String> {
    // Comma-separated origin allowlist from `ALLOY_ALLOWED_ORIGINS`.
    let raw = std::env::var("ALLOY_ALLOWED_ORIGINS").unwrap_or_else(|_| {
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
            .to_string()
    });
    raw.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_end_matches('/').to_ascii_lowercase())
        .collect()
}

fn host_port_from_origin(origin: &str) -> Option<String> {
    let trimmed = origin.trim();
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))?;
    let host_port = rest.split('/').next()?.trim();
    if host_port.is_empty() {
        return None;
    }
    Some(host_port.to_ascii_lowercase())
}

fn origin_is_same_host(headers: &HeaderMap, origin: &str) -> bool {
    let Some(host) = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
    else {
        return false;
    };

    let Some(origin_host) = host_port_from_origin(origin) else {
        return false;
    };

    host == origin_host
}

fn validate_origin(request_id: Option<&str>, headers: &HeaderMap) -> Result<(), Response> {
    let has_cookie = request_has_cookie_header(headers);
    let origin_header = headers.get(axum::http::header::ORIGIN);

    let origin = match origin_header {
        Some(v) => v.to_str().map_err(|_| {
            json_auth_error(
                request_id,
                StatusCode::FORBIDDEN,
                "origin_invalid_header",
                "origin header is not valid UTF-8",
            )
        })?,
        None => {
            if has_cookie {
                return Err(json_auth_error(
                    request_id,
                    StatusCode::FORBIDDEN,
                    "origin_required",
                    "origin header required for cookie-authenticated unsafe request",
                ));
            }
            return Ok(());
        }
    };

    let origin_normalized = origin.trim().trim_end_matches('/').to_ascii_lowercase();

    if !origin_normalized.starts_with("http://") && !origin_normalized.starts_with("https://") {
        return Err(json_auth_error(
            request_id,
            StatusCode::FORBIDDEN,
            "origin_invalid_scheme",
            "origin must use http or https",
        ));
    }

    if origin_is_same_host(headers, &origin_normalized) {
        return Ok(());
    }

    let allowed = parse_allowed_origins();
    if allowed.iter().any(|a| a == &origin_normalized) {
        return Ok(());
    }

    Err(json_auth_error(
        request_id,
        StatusCode::FORBIDDEN,
        "origin_not_allowed",
        format!("origin '{origin_normalized}' is not in allowlist"),
    ))
}

fn request_has_cookie_header(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn validate_csrf(request_id: Option<&str>, headers: &HeaderMap) -> Result<(), Response> {
    let jar = CookieJar::from_headers(headers);
    let cookie = match jar.get(CSRF_COOKIE_NAME) {
        Some(c) => c,
        None => {
            return Err(json_auth_error(
                request_id,
                StatusCode::FORBIDDEN,
                "csrf_cookie_missing",
                "csrf cookie missing",
            ));
        }
    };

    if cookie.value().trim().is_empty() {
        return Err(json_auth_error(
            request_id,
            StatusCode::FORBIDDEN,
            "csrf_cookie_empty",
            "csrf cookie is empty",
        ));
    }

    let header = match headers.get(CSRF_HEADER_NAME).and_then(|v| v.to_str().ok()) {
        Some(v) => v,
        None => {
            return Err(json_auth_error(
                request_id,
                StatusCode::FORBIDDEN,
                "csrf_header_missing",
                "csrf header missing",
            ));
        }
    };

    if header.trim().is_empty() {
        return Err(json_auth_error(
            request_id,
            StatusCode::FORBIDDEN,
            "csrf_header_empty",
            "csrf header is empty",
        ));
    }

    if cookie.value() != header {
        return Err(json_auth_error(
            request_id,
            StatusCode::FORBIDDEN,
            "csrf_mismatch",
            "csrf token mismatch",
        ));
    }

    Ok(())
}

// Middleware: double-submit CSRF + Origin allowlist.
//
// Apply this to state-changing routes (e.g. /auth/* POSTs). It intentionally does
// not try to distinguish which handlers are "mutations".
pub async fn csrf_and_origin(req: Request<Body>, next: Next) -> Response {
    if !is_unsafe_method(req.method()) {
        return next.run(req).await;
    }

    let request_id = req
        .extensions()
        .get::<RequestMeta>()
        .map(|v| v.request_id.clone());

    let headers = req.headers();
    if let Err(resp) = validate_origin(request_id.as_deref(), headers) {
        return resp;
    }

    if request_has_cookie_header(headers)
        && let Err(resp) = validate_csrf(request_id.as_deref(), headers)
    {
        return resp;
    }

    next.run(req).await
}

// Middleware: require a valid access JWT cookie for `/rspc` requests.
//
// Allowlist a few public procedures so the UI can show health/version before login.
pub async fn rspc_auth_guard(req: Request<Body>, next: Next) -> Response {
    let request_id = req
        .extensions()
        .get::<RequestMeta>()
        .map(|v| v.request_id.clone());

    // `/rspc/<procedure>` (v2 endpoint uses `/:id`).
    let path = req.uri().path();
    let proc = path.strip_prefix('/').unwrap_or(path);

    // Health endpoints should remain public.
    if matches!(proc, "control.ping" | "agent.health") {
        return next.run(req).await;
    }

    let headers = req.headers();
    let jar = CookieJar::from_headers(headers);
    let token = match jar.get(ACCESS_COOKIE_NAME) {
        Some(c) => c.value(),
        None => {
            return json_auth_error(
                request_id.as_deref(),
                StatusCode::UNAUTHORIZED,
                "access_token_missing",
                "missing access token",
            );
        }
    };

    let user = match validate_access_jwt(token) {
        Ok(u) => AuthUser {
            user_id: u.user_id,
            username: u.username,
            is_admin: u.is_admin,
        },
        Err(_) => {
            return json_auth_error(
                request_id.as_deref(),
                StatusCode::UNAUTHORIZED,
                "access_token_invalid",
                "invalid access token",
            );
        }
    };

    let mut req = req;
    req.extensions_mut().insert(user);
    next.run(req).await
}

const REQUEST_ID_HEADER_NAME: &str = "x-request-id";

const HEADER_CF_CONNECTING_IP: &str = "cf-connecting-ip";
const HEADER_X_FORWARDED_FOR: &str = "x-forwarded-for";
const HEADER_X_REAL_IP: &str = "x-real-ip";

fn header_value_to_string(
    headers: &HeaderMap,
    name: axum::http::header::HeaderName,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_first_forwarded_for_ip(raw: &str) -> Option<String> {
    let first = raw.split(',').next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

fn client_ip_hint_from_headers(headers: &HeaderMap) -> Option<String> {
    if let Some(v) = headers
        .get(HEADER_CF_CONNECTING_IP)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        return Some(v.to_string());
    }

    if let Some(v) = headers
        .get(HEADER_X_REAL_IP)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        return Some(v.to_string());
    }

    if let Some(v) = headers
        .get(HEADER_X_FORWARDED_FOR)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        return get_first_forwarded_for_ip(v);
    }

    None
}

fn generate_request_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

// Middleware: request id propagation.
//
// - If the client supplies `x-request-id`, keep it (best-effort).
// - Otherwise generate one.
// - Always echo `x-request-id` back in the response and expose it to handlers via extensions.
pub async fn request_id(mut req: Request<Body>, next: Next) -> Response {
    let rid = req
        .headers()
        .get(REQUEST_ID_HEADER_NAME)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(generate_request_id);

    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let origin = header_value_to_string(req.headers(), axum::http::header::ORIGIN);
    let referer = header_value_to_string(req.headers(), axum::http::header::REFERER);
    let user_agent = header_value_to_string(req.headers(), axum::http::header::USER_AGENT);
    let client_ip = client_ip_hint_from_headers(req.headers());

    req.extensions_mut().insert(RequestMeta {
        request_id: rid.clone(),
        method: method.clone(),
        path: path.clone(),
        origin,
        referer,
        user_agent,
        client_ip,
    });

    let span = tracing::info_span!("http", request_id = %rid, %method, %path);
    let mut resp = next.run(req).instrument(span).await;
    if let Ok(v) = HeaderValue::from_str(&rid) {
        resp.headers_mut().insert(REQUEST_ID_HEADER_NAME, v);
    }
    resp
}
