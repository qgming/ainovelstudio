use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use uuid::Uuid;

type CommandResult<T> = Result<T, String>;

const CONNECTION_TEST_SYSTEM: &str = "你是连接测试助手。请直接回复一句不超过20字的自然语言，确认你已收到这条测试消息。不要调用工具，不要返回 JSON。";
const CONNECTION_TEST_PROMPT: &str = "请直接回复一句简短的话，确认你已收到这条测试消息。";
const DEFAULT_REASONING_EFFORT: &str = "xhigh";
const OPENCODE_CLIENT: &str = "cli";
const OPENCODE_PROJECT: &str = "global";

static OPENCODE_SESSION_ID: OnceLock<String> = OnceLock::new();

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderConfig {
    #[serde(default)]
    api_key: String,
    #[serde(default, rename = "baseURL")]
    base_url: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    enable_reasoning_effort: bool,
    #[serde(default)]
    reasoning_effort: String,
    #[serde(default)]
    simulate_opencode_beta: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHttpResponse {
    ok: bool,
    status: u16,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardProviderRequest {
    #[serde(default)]
    method: String,
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardProviderResponse {
    ok: bool,
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

fn create_opencode_id(prefix: &str) -> String {
    format!("{prefix}{}", Uuid::new_v4().simple())
}

fn get_opencode_session_id() -> &'static str {
    OPENCODE_SESSION_ID
        .get_or_init(|| create_opencode_id("ses_"))
        .as_str()
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn normalized_reasoning_effort(config: &AgentProviderConfig) -> &'static str {
    match config.reasoning_effort.trim() {
        "low" => "low",
        "medium" => "medium",
        "high" => "high",
        "xhigh" => "xhigh",
        _ => DEFAULT_REASONING_EFFORT,
    }
}

fn build_request_headers(
    config: &AgentProviderConfig,
    include_json_body: bool,
) -> CommandResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let auth_value = format!("Bearer {}", config.api_key.trim());
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth_value).map_err(|error| error.to_string())?,
    );
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));

    if include_json_body {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }

    if config.simulate_opencode_beta {
        headers.insert(
            HeaderName::from_static("x-opencode-client"),
            HeaderValue::from_static(OPENCODE_CLIENT),
        );
        headers.insert(
            HeaderName::from_static("x-opencode-project"),
            HeaderValue::from_static(OPENCODE_PROJECT),
        );
        headers.insert(
            HeaderName::from_static("x-opencode-request"),
            HeaderValue::from_str(&create_opencode_id("msg_"))
                .map_err(|error| error.to_string())?,
        );
        headers.insert(
            HeaderName::from_static("x-opencode-session"),
            HeaderValue::from_str(get_opencode_session_id()).map_err(|error| error.to_string())?,
        );
    }

    Ok(headers)
}

async fn send_request(
    config: AgentProviderConfig,
    path: &str,
    method: reqwest::Method,
    body: Option<Value>,
) -> CommandResult<ProviderHttpResponse> {
    let url = format!("{}{}", normalize_base_url(&config.base_url), path);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;

    let mut request = client
        .request(method, url)
        .headers(build_request_headers(&config, body.is_some())?);

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(ProviderHttpResponse { ok, status, body })
}

fn build_forward_headers(headers: HashMap<String, String>) -> CommandResult<HeaderMap> {
    let mut header_map = HeaderMap::new();

    for (key, value) in headers {
        let header_name =
            HeaderName::from_bytes(key.as_bytes()).map_err(|error| error.to_string())?;
        let header_value = HeaderValue::from_str(&value).map_err(|error| error.to_string())?;
        header_map.insert(header_name, header_value);
    }

    Ok(header_map)
}

#[tauri::command]
pub async fn fetch_provider_models(
    config: AgentProviderConfig,
) -> CommandResult<ProviderHttpResponse> {
    send_request(config, "/models", reqwest::Method::GET, None).await
}

#[tauri::command]
pub async fn probe_provider_connection(
    config: AgentProviderConfig,
) -> CommandResult<ProviderHttpResponse> {
    let mut body = json!({
        "model": config.model.trim(),
        "messages": [
            {
                "role": "system",
                "content": CONNECTION_TEST_SYSTEM,
            },
            {
                "role": "user",
                "content": CONNECTION_TEST_PROMPT,
            }
        ]
    });

    if config.enable_reasoning_effort {
        body["reasoning_effort"] = Value::String(normalized_reasoning_effort(&config).to_string());
    }

    send_request(
        config,
        "/chat/completions",
        reqwest::Method::POST,
        Some(body),
    )
    .await
}

#[tauri::command]
pub async fn forward_provider_request(
    request: ForwardProviderRequest,
) -> CommandResult<ForwardProviderResponse> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| error.to_string())?;
    let method = reqwest::Method::from_bytes(request.method.trim().as_bytes())
        .map_err(|error| error.to_string())?;
    let mut request_builder = client
        .request(method, request.url)
        .headers(build_forward_headers(request.headers)?);

    if let Some(body) = request.body {
        request_builder = request_builder.body(body);
    }

    let response = request_builder
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|parsed| (key.to_string(), parsed.to_string()))
        })
        .collect::<HashMap<_, _>>();
    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(ForwardProviderResponse {
        ok,
        status,
        headers,
        body,
    })
}
