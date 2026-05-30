use super::provider_forward::{
    build_forward_headers, validate_forward_request, ForwardProviderRequest,
    ForwardProviderResponse, FORWARD_REQUEST_TIMEOUT_SECS,
};
use reqwest::Url;
use std::collections::HashMap;
use std::time::Duration;

type CommandResult<T> = Result<T, String>;

// Provider 请求转发（绕 CORS），仅服务工具类请求（联网搜索 / 网页抓取 / 排行榜）。
// LLM 模型调用已迁至前端 pi-ai（走 webview 原生 fetch），
// 历史的 fetch_provider_models / probe_provider_connection / stream_provider_request /
// cancel_provider_stream 命令已随 pi 重构（CP2）移除——取模型列表改前端直接 fetch(/models)，
// 连接测试改 pi complete()，流式对话由 pi Agent 经原生 fetch 直连。
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
