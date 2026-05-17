use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Url,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;

pub(crate) type CommandResult<T> = Result<T, String>;

pub(crate) const FORWARD_REQUEST_TIMEOUT_SECS: u64 = 60;

const FORWARD_MODE_PROVIDER: &str = "provider";
const MAX_FORWARD_BODY_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardProviderRequest {
    #[serde(default, rename = "baseUrl")]
    pub(crate) base_url: Option<String>,
    #[serde(default)]
    pub(crate) method: String,
    pub(crate) headers: HashMap<String, String>,
    #[serde(default)]
    pub(crate) mode: Option<String>,
    #[serde(default)]
    pub(crate) body: Option<String>,
    #[serde(default, rename = "requestId")]
    pub(crate) request_id: Option<String>,
    pub(crate) url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardProviderResponse {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: String,
}

fn is_blocked_forward_header(name: &str) -> bool {
    matches!(
        name,
        "connection"
            | "content-length"
            | "host"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn is_public_web_header_allowed(name: &str) -> bool {
    matches!(name, "accept" | "cache-control" | "user-agent")
}

pub(crate) fn build_forward_headers(
    headers: HashMap<String, String>,
    mode: &str,
) -> CommandResult<HeaderMap> {
    let mut header_map = HeaderMap::new();
    for (key, value) in headers {
        let normalized_key = key.trim().to_ascii_lowercase();
        if normalized_key.is_empty() || is_blocked_forward_header(&normalized_key) {
            continue;
        }
        if mode != FORWARD_MODE_PROVIDER && !is_public_web_header_allowed(&normalized_key) {
            continue;
        }
        let header_name =
            HeaderName::from_bytes(normalized_key.as_bytes()).map_err(|error| error.to_string())?;
        let header_value = HeaderValue::from_str(&value).map_err(|error| error.to_string())?;
        header_map.insert(header_name, header_value);
    }
    Ok(header_map)
}

fn validate_http_url(url: &Url) -> CommandResult<()> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("仅支持 HTTP/HTTPS 请求。".into());
    }
    Ok(())
}

fn is_blocked_public_host(url: &Url) -> bool {
    let Some(host) = url.host_str().map(|value| value.to_ascii_lowercase()) else {
        return true;
    };
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .map(is_blocked_public_ip)
        .unwrap_or(false)
}

fn is_blocked_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified()
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
        }
    }
}

fn validate_public_web_request(
    method: &reqwest::Method,
    url: &Url,
    body: Option<&String>,
) -> CommandResult<()> {
    if *method != reqwest::Method::GET && *method != reqwest::Method::HEAD {
        return Err("公开网页请求仅支持 GET/HEAD。".into());
    }
    if body.is_some() {
        return Err("公开网页请求不能包含请求体。".into());
    }
    if is_blocked_public_host(url) {
        return Err("公开网页请求不允许访问本机或内网地址。".into());
    }
    Ok(())
}

fn path_is_under_base(target_path: &str, base_path: &str) -> bool {
    let normalized_base = base_path.trim_end_matches('/');
    normalized_base.is_empty()
        || normalized_base == "/"
        || target_path == normalized_base
        || target_path.starts_with(&format!("{normalized_base}/"))
}

fn validate_provider_request(
    request: &ForwardProviderRequest,
    method: &reqwest::Method,
    url: &Url,
) -> CommandResult<()> {
    if *method != reqwest::Method::GET && *method != reqwest::Method::POST {
        return Err("模型供应商请求仅支持 GET/POST。".into());
    }
    let base_url = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "模型供应商请求缺少 baseURL。".to_string())?;
    let parsed_base_url = Url::parse(base_url).map_err(|error| error.to_string())?;
    validate_http_url(&parsed_base_url)?;
    validate_provider_scope(url, &parsed_base_url)
}

fn validate_provider_scope(url: &Url, base_url: &Url) -> CommandResult<()> {
    let same_origin = url.scheme() == base_url.scheme()
        && url.host_str() == base_url.host_str()
        && url.port_or_known_default() == base_url.port_or_known_default();
    if !same_origin || !path_is_under_base(url.path(), base_url.path()) {
        return Err("模型供应商请求超出已配置的 baseURL 范围。".into());
    }
    Ok(())
}

pub(crate) fn validate_forward_request(
    request: &ForwardProviderRequest,
    method: &reqwest::Method,
    url: &Url,
) -> CommandResult<String> {
    validate_http_url(url)?;
    if request
        .body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_FORWARD_BODY_BYTES)
    {
        return Err("请求体过大。".into());
    }
    let mode = request.mode.as_deref().unwrap_or("").trim();
    if mode == FORWARD_MODE_PROVIDER {
        validate_provider_request(request, method, url)?;
        return Ok(FORWARD_MODE_PROVIDER.into());
    }
    validate_public_web_request(method, url, request.body.as_ref())?;
    Ok("public_web".into())
}
