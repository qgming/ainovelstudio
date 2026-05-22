use super::provider_forward::{
    build_forward_headers, validate_forward_request, ForwardProviderRequest,
    ForwardProviderResponse, FORWARD_REQUEST_TIMEOUT_SECS,
};
use crate::app::ToolCancellationRegistry;
use crate::domains::debug::commands::{record_ai_call_log, NewAiCallLog};
use futures_util::StreamExt;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

type CommandResult<T> = Result<T, String>;

const CONNECTION_TEST_SYSTEM: &str = "你是连接测试助手。请直接回复一句不超过20字的自然语言，确认你已收到这条测试消息。不要调用工具，不要返回 JSON。";
const CONNECTION_TEST_PROMPT: &str = "请直接回复一句简短的话，确认你已收到这条测试消息。";
const STREAM_RESPONSE_LOG_LIMIT_BYTES: usize = 128 * 1024;
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
    simulate_opencode_beta: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHttpResponse {
    ok: bool,
    status: u16,
    body: String,
}

#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum ProviderStreamEvent {
    Start {
        request_id: String,
        ok: bool,
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        request_id: String,
        chunk: Vec<u8>,
    },
    End {
        request_id: String,
    },
    Error {
        request_id: String,
        message: String,
    },
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
    app: Option<&AppHandle>,
    config: AgentProviderConfig,
    path: &str,
    method: reqwest::Method,
    body: Option<Value>,
) -> CommandResult<ProviderHttpResponse> {
    let url = format!("{}{}", normalize_base_url(&config.base_url), path);
    let method_label = method.as_str().to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;

    let mut request = client
        .request(method, url.clone())
        .headers(build_request_headers(&config, body.is_some())?);

    let request_body = body.as_ref().map(Value::to_string).unwrap_or_default();
    if let Some(body) = body.as_ref() {
        request = request.json(body);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            let message = error.to_string();
            if let Some(app) = app.filter(|_| path == "/chat/completions") {
                let _ = record_ai_call_log(
                    app,
                    NewAiCallLog {
                        method: method_label,
                        url,
                        status: 0,
                        ok: false,
                        request_json: request_body,
                        response_json: String::new(),
                        error: message.clone(),
                    },
                );
            }
            return Err(message);
        }
    };
    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body = response.text().await.map_err(|error| error.to_string())?;

    if let Some(app) = app.filter(|_| path == "/chat/completions") {
        let _ = record_ai_call_log(
            app,
            NewAiCallLog {
                method: method_label,
                url,
                status,
                ok,
                request_json: request_body,
                response_json: body.clone(),
                error: String::new(),
            },
        );
    }

    Ok(ProviderHttpResponse { ok, status, body })
}

#[tauri::command]
pub async fn fetch_provider_models(
    config: AgentProviderConfig,
) -> CommandResult<ProviderHttpResponse> {
    send_request(None, config, "/models", reqwest::Method::GET, None).await
}

#[tauri::command]
pub async fn probe_provider_connection(
    app: AppHandle,
    config: AgentProviderConfig,
) -> CommandResult<ProviderHttpResponse> {
    let body = json!({
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

    send_request(
        Some(&app),
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
        .timeout(Duration::from_secs(FORWARD_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let method = reqwest::Method::from_bytes(request.method.trim().as_bytes())
        .map_err(|error| error.to_string())?;
    let url = Url::parse(request.url.trim()).map_err(|error| error.to_string())?;
    let mode = validate_forward_request(&request, &method, &url)?;
    let mut request_builder = client
        .request(method, url)
        .headers(build_forward_headers(request.headers, &mode)?);

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

#[tauri::command]
pub async fn stream_provider_request(
    app: AppHandle,
    request: ForwardProviderRequest,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    let request_id = request
        .request_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "流式请求缺少 requestId。".to_string())?;
    let request_for_error_log = request.clone();
    registry.begin(Some(&request_id));

    let result = stream_provider_request_inner(&app, request, &request_id, &registry).await;
    registry.finish(Some(&request_id));
    if let Err(message) = result {
        let _ = record_ai_call_log(
            &app,
            NewAiCallLog {
                method: request_for_error_log.method,
                url: request_for_error_log.url,
                status: 0,
                ok: false,
                request_json: request_for_error_log.body.unwrap_or_default(),
                response_json: String::new(),
                error: message.clone(),
            },
        );
        emit_stream_event(
            &app,
            ProviderStreamEvent::Error {
                request_id,
                message,
            },
        );
    }
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn cancel_provider_stream(
    requestId: String,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    registry.cancel(&requestId);
    Ok(())
}

async fn stream_provider_request_inner(
    app: &AppHandle,
    request: ForwardProviderRequest,
    request_id: &str,
    registry: &ToolCancellationRegistry,
) -> CommandResult<()> {
    let log_method = request.method.clone();
    let log_url = request.url.clone();
    let log_request_json = request.body.clone().unwrap_or_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FORWARD_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let method = reqwest::Method::from_bytes(request.method.trim().as_bytes())
        .map_err(|error| error.to_string())?;
    let url = Url::parse(request.url.trim()).map_err(|error| error.to_string())?;
    let mode = validate_forward_request(&request, &method, &url)?;
    let mut request_builder = client
        .request(method, url)
        .headers(build_forward_headers(request.headers, &mode)?);

    if let Some(body) = request.body {
        request_builder = request_builder.body(body);
    }

    registry.check(Some(request_id))?;
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

    emit_stream_event(
        app,
        ProviderStreamEvent::Start {
            request_id: request_id.to_string(),
            ok,
            status,
            headers,
        },
    );

    let mut response_body_log = Vec::<u8>::new();
    let mut response_body_bytes = 0usize;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        registry.check(Some(request_id))?;
        let chunk = match chunk {
            Ok(value) => value,
            Err(error) => {
                // 流读取/解码失败时附加最近 1KB 字节诊断（hex + lossy）
                let diagnostic = format_decode_error_diagnostic(&error, &response_body_log);
                return Err(diagnostic);
            }
        };
        response_body_bytes += chunk.len();
        if response_body_log.len() < STREAM_RESPONSE_LOG_LIMIT_BYTES {
            let remaining = STREAM_RESPONSE_LOG_LIMIT_BYTES - response_body_log.len();
            response_body_log.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        }
        emit_stream_event(
            app,
            ProviderStreamEvent::Chunk {
                request_id: request_id.to_string(),
                chunk: chunk.to_vec(),
            },
        );
    }

    emit_stream_event(
        app,
        ProviderStreamEvent::End {
            request_id: request_id.to_string(),
        },
    );
    let _ = record_ai_call_log(
        app,
        NewAiCallLog {
            method: log_method,
            url: log_url,
            status,
            ok,
            request_json: log_request_json,
            response_json: format_stream_response_log(&response_body_log, response_body_bytes),
            error: String::new(),
        },
    );
    Ok(())
}

fn emit_stream_event(app: &AppHandle, payload: ProviderStreamEvent) {
    let _ = app.emit("provider-stream", payload);
}

fn format_stream_response_log(bytes: &[u8], total_bytes: usize) -> String {
    let mut body = String::from_utf8_lossy(bytes).into_owned();
    if total_bytes > bytes.len() {
        body.push_str(&format!(
            "\n\n[stream log truncated: captured {} of {} bytes]",
            bytes.len(),
            total_bytes
        ));
    }
    body
}

// 当上游流读取/解码失败时，把已经累计的最后 1KB 字节做 hex + utf-8 lossy 诊断附在错误信息后面。
// 这样用户复现时能直接把日志贴出来定位真实字节内容（是否伪 JSON / 是否含乱码 / 是否被截断）。
//
// **跨语言契约**：以下 3 个 token 由前端 DebugSection.tsx::parseErrorDiagnostic 解析。
// 若需修改任意 token 字面值，必须同步修改前端解析逻辑（搜索 "[diagnostic:" / "[utf-8 lossy]:" / "[hex]:"）。
const DIAGNOSTIC_HEADER_PREFIX: &str = "[diagnostic:";
const UTF8_LOSSY_MARKER: &str = "[utf-8 lossy]:";
const HEX_MARKER: &str = "[hex]:";

fn format_decode_error_diagnostic(error: &reqwest::Error, buffered: &[u8]) -> String {
    format_decode_diagnostic_with_message(&error.to_string(), buffered)
}

// 与 format_decode_error_diagnostic 的区别：只接收已转字符串的错误消息，便于单测。
fn format_decode_diagnostic_with_message(error_message: &str, buffered: &[u8]) -> String {
    const TAIL_BYTES: usize = 1024;
    let start = buffered.len().saturating_sub(TAIL_BYTES);
    let tail = &buffered[start..];
    let lossy = String::from_utf8_lossy(tail);
    let hex: String = tail
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "{}\n\n{} last {} of {} buffered bytes]\n{}\n{}\n{}\n{}",
        error_message,
        DIAGNOSTIC_HEADER_PREFIX,
        tail.len(),
        buffered.len(),
        UTF8_LOSSY_MARKER,
        lossy,
        HEX_MARKER,
        hex,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_with_empty_buffer_includes_zero_lengths() {
        let out = format_decode_diagnostic_with_message("boom", &[]);
        assert!(out.starts_with("boom\n\n"));
        assert!(out.contains("[diagnostic: last 0 of 0 buffered bytes]"));
        assert!(out.contains("[utf-8 lossy]:"));
        assert!(out.contains("[hex]:"));
    }

    #[test]
    fn diagnostic_with_small_buffer_emits_all_bytes() {
        let buffered = b"hello";
        let out = format_decode_diagnostic_with_message("boom", buffered);
        assert!(out.contains("[diagnostic: last 5 of 5 buffered bytes]"));
        assert!(out.contains("hello"));
        // hex: 68 65 6c 6c 6f
        assert!(out.contains("68 65 6c 6c 6f"));
    }

    #[test]
    fn diagnostic_with_large_buffer_truncates_to_tail_bytes() {
        // 2 KB 缓冲，仅最后 1 KB 出现在诊断中
        let buffered: Vec<u8> = (0..2048).map(|i| (i % 256) as u8).collect();
        let out = format_decode_diagnostic_with_message("boom", &buffered);
        assert!(out.contains("[diagnostic: last 1024 of 2048 buffered bytes]"));
        // hex 部分应只包含 1024 字节 = 1024 个十六进制对 + 1023 个分隔空格
        let hex_section = out
            .split("[hex]:\n")
            .nth(1)
            .expect("hex 段应存在");
        let hex_pairs: Vec<&str> = hex_section.split_whitespace().collect();
        assert_eq!(hex_pairs.len(), 1024);
    }
}
