use axum::{
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;

use crate::auth::CSRF_COOKIE_NAME;

const CSRF_HEADER_NAME: &str = "x-csrf-token";

#[derive(Debug, Serialize)]
struct ErrorBody {
    message: String,
}

fn json_error(code: StatusCode, message: impl Into<String>) -> Response {
    (code, axum::Json(ErrorBody { message: message.into() })).into_response()
}

fn is_unsafe_method(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

fn parse_allowed_origins() -> Vec<String> {
    // Dev-friendly defaults. Production should set `ALLOY_ALLOWED_ORIGINS` explicitly.
    //
    // Examples:
    // - ALLOY_ALLOWED_ORIGINS=http://localhost:5173
    // - ALLOY_ALLOWED_ORIGINS=https://panel.example.com,https://control.example.com
    let raw = std::env::var("ALLOY_ALLOWED_ORIGINS").unwrap_or_else(|_| {
        "http://localhost:5173,http://127.0.0.1:5173".to_string()
    });
    raw.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn origin_is_allowed(headers: &HeaderMap) -> bool {
    // Treat missing Origin as a non-browser client (curl, service-to-service).
    // For browsers, Origin should be present for unsafe methods.
    let origin = match headers.get(axum::http::header::ORIGIN) {
        Some(v) => match v.to_str() {
            Ok(s) => s,
            Err(_) => return false,
        },
        None => return true,
    };

    let allowed = parse_allowed_origins();
    allowed.iter().any(|a| a == origin)
}

fn request_has_cookie_header(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn csrf_is_valid(headers: &HeaderMap) -> bool {
    let jar = CookieJar::from_headers(headers);
    let cookie = match jar.get(CSRF_COOKIE_NAME) {
        Some(c) => c,
        None => return false,
    };

    let header = match headers.get(CSRF_HEADER_NAME).and_then(|v| v.to_str().ok()) {
        Some(v) => v,
        None => return false,
    };

    cookie.value() == header
}

// Middleware: double-submit CSRF + Origin allowlist.
//
// Apply this to state-changing routes (e.g. /auth/* POSTs). It intentionally does
// not try to distinguish which handlers are "mutations".
pub async fn csrf_and_origin(req: Request<Body>, next: Next) -> Response {
    if !is_unsafe_method(req.method()) {
        return next.run(req).await;
    }

    let headers = req.headers();
    if !origin_is_allowed(headers) {
        return json_error(StatusCode::FORBIDDEN, "origin not allowed");
    }

    // Only enforce CSRF when cookies are present; this keeps non-browser and
    // service-to-service clients workable without forcing CSRF headers.
    if request_has_cookie_header(headers) && !csrf_is_valid(headers) {
        return json_error(StatusCode::FORBIDDEN, "csrf invalid");
    }

    next.run(req).await
}
