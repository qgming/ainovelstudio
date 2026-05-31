use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

// LLM 流式转发的取消注册表。
//
// 每个流式请求 register 出一个 CancelToken（内含 Arc<Notify>），命令循环里用
// tokio::select! 同时 await `cancel.cancelled()` 与 `stream.next()`，从而即便卡在
// 等待下一个 chunk（socket 静默）也能被 cancel_provider_stream 立刻打断。
//
// 与 app::cancellation::ToolCancellationRegistry 的区别：那个是轮询式 AtomicBool
// （工具执行在 await 点之间查标志），本表用 Notify 做即时唤醒，适配流式读 socket 的长等待。
#[derive(Default)]
pub struct ProviderStreamRegistry {
    inner: Mutex<HashMap<String, Arc<Notify>>>,
}

// 单个流式请求的取消令牌。持有对应的 Notify，`cancelled()` 在被 cancel 时 resolve。
pub struct CancelToken(Arc<Notify>);

impl CancelToken {
    pub async fn cancelled(&self) {
        self.0.notified().await;
    }
}

impl ProviderStreamRegistry {
    // 注册一个请求，返回其取消令牌。重复 requestId 会覆盖旧条目（前端 requestId 用 uuid，正常不冲突）。
    pub fn register(&self, request_id: &str) -> CancelToken {
        let notify = Arc::new(Notify::new());
        if let Ok(mut map) = self.inner.lock() {
            map.insert(request_id.to_string(), notify.clone());
        }
        CancelToken(notify)
    }

    // 触发指定请求的取消：唤醒所有等待该 Notify 的 await 点。
    pub fn cancel(&self, request_id: &str) {
        if let Ok(map) = self.inner.lock() {
            if let Some(notify) = map.get(request_id) {
                notify.notify_waiters();
            }
        }
    }

    // 命令结束时注销，避免注册表泄漏。
    pub fn remove(&self, request_id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(request_id);
        }
    }
}
