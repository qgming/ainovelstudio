use super::provider_forward::{
    build_forward_headers, validate_forward_request, ForwardProviderRequest,
    FORWARD_REQUEST_TIMEOUT_SECS,
};
use super::provider_stream_registry::ProviderStreamRegistry;
use futures_util::StreamExt;
use reqwest::Url;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

type CommandResult<T> = Result<T, String>;

// 经 Channel 增量回传给前端的流式事件。
// serde 默认 externally-tagged + tag="type"，前端收到形如：
//   { type:"open", status, ok, headers } / { type:"chunk", bytes:[...] }
//   / { type:"done" } / { type:"error", message }
//
// 设计要点（见计划「错误分水岭」）：
// - Open 在首个 chunk 之前发，前端据 status/headers 构造 Response，OpenAI SDK 据此判 2xx/读错误。
// - 「是否已发过 Open」是「网络失败 vs HTTP 错误」的分水岭：
//   Open 前失败 = 网络层（前端伪造 fetch 直接 reject）；Open 后 = HTTP 响应已建立。
// - 非 2xx 不转 Error：照常 Open(ok=false) + 把错误 JSON body 当 Chunk 流回，交给 SDK 读取，
//   与非流式 forward_provider_request 的透明转发语义一致。
// - chunk 用 Vec<u8> 原始字节（serde→JSON number[]），前端用 TextDecoder({stream:true}) 解码，
//   天然处理 UTF-8 多字节字符被网络分片切断的情况。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub(crate) enum StreamEvent {
    Open {
        status: u16,
        ok: bool,
        headers: HashMap<String, String>,
    },
    Chunk {
        bytes: Vec<u8>,
    },
    Done,
    Error {
        message: String,
    },
}

// 命令结束时自动从注册表注销，保证任何 return 路径都清理。
struct CancelGuard<'a> {
    registry: &'a ProviderStreamRegistry,
    request_id: &'a str,
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        self.registry.remove(self.request_id);
    }
}

// LLM 模型调用的流式转发（走 Rust reqwest 代理，绕 CORS / 统一 SSRF 守卫）。
//
// 前端把 OpenAI SDK 的 globalThis.fetch 包一层，命中 POST {baseURL}/chat/completions
// 的请求改调本命令；Rust 用 reqwest::bytes_stream() 把 SSE chunk 经 Channel 增量回传，
// 前端再拼成 ReadableStream 喂回伪造 Response，让 SDK 的 getReader() 逐字消费。
//
// 复用 provider_forward 的请求构建与 SSRF 守卫，与非流式 forward_provider_request 完全一致。
#[tauri::command]
#[allow(non_snake_case)]
pub async fn stream_provider_request(
    request: ForwardProviderRequest,
    requestId: String,
    channel: Channel<StreamEvent>,
    registry: State<'_, ProviderStreamRegistry>,
) -> CommandResult<()> {
    // 1) 复用现有 SSRF 守卫 + header 构建（与 forward_provider_request 一致）。
    //    这一段失败（构造/校验阶段，尚未开始流）直接返回 Err，前端 invoke().catch() 拿到。
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

    // 2) 注册取消令牌；guard 确保命令任何返回路径都注销。
    let cancel = registry.register(&requestId);
    let _guard = CancelGuard {
        registry: &registry,
        request_id: &requestId,
    };

    // 3) 发请求。用 select! 让取消能打断尚未返回 header 的连接阶段。
    //    此时还没发 Open：连接失败 = 网络层，发 Error 收尾、命令仍返回 Ok（前端只从 Channel 收业务错误）。
    let response = tokio::select! {
        _ = cancel.cancelled() => {
            let _ = channel.send(StreamEvent::Error { message: "请求已取消。".into() });
            return Ok(());
        }
        result = request_builder.send() => match result {
            Ok(response) => response,
            Err(error) => {
                let _ = channel.send(StreamEvent::Error { message: error.to_string() });
                return Ok(());
            }
        }
    };

    // 4) 先回传 status + headers。非 2xx 也照常 Open(ok=false)，body 随后当 Chunk 流回。
    let status = response.status();
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
    if channel
        .send(StreamEvent::Open {
            status: status.as_u16(),
            ok: status.is_success(),
            headers,
        })
        .is_err()
    {
        return Ok(()); // 前端 Channel 已不可达
    }

    // 5) 流式逐块回传。Open 之后的失败（读流中断/取消）也发 Error，但前端此时已建好 Response，
    //    会用 controller.error() 让 SDK 读取中途抛错。
    let mut stream = response.bytes_stream();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = channel.send(StreamEvent::Error { message: "请求已取消。".into() });
                return Ok(());
            }
            next = stream.next() => match next {
                Some(Ok(bytes)) => {
                    if channel.send(StreamEvent::Chunk { bytes: bytes.to_vec() }).is_err() {
                        return Ok(()); // 前端关闭
                    }
                }
                Some(Err(error)) => {
                    let _ = channel.send(StreamEvent::Error { message: error.to_string() });
                    return Ok(());
                }
                None => {
                    let _ = channel.send(StreamEvent::Done);
                    return Ok(());
                }
            }
        }
    }
}

// 取消指定 requestId 的流式请求：唤醒命令循环里等待该 Notify 的 select! 分支。
#[tauri::command]
#[allow(non_snake_case)]
pub fn cancel_provider_stream(
    requestId: String,
    registry: State<'_, ProviderStreamRegistry>,
) -> CommandResult<()> {
    registry.cancel(&requestId);
    Ok(())
}
