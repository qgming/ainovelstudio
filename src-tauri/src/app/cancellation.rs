use std::{collections::HashSet, sync::Mutex};

pub struct ToolCancellationRegistry {
    cancelled: Mutex<HashSet<String>>,
}

impl Default for ToolCancellationRegistry {
    fn default() -> Self {
        Self {
            cancelled: Mutex::new(HashSet::new()),
        }
    }
}

impl ToolCancellationRegistry {
    pub fn begin(&self, request_id: Option<&str>) {
        let _ = request_id;
    }

    pub fn cancel(&self, request_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.insert(request_id.to_string());
        }
    }

    pub fn clear(&self, request_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(request_id);
        }
    }

    pub fn check(&self, request_id: Option<&str>) -> Result<(), String> {
        let Some(request_id) = request_id else {
            return Ok(());
        };

        let cancelled = self
            .cancelled
            .lock()
            .map_err(|_| "取消状态访问失败。".to_string())?;
        if cancelled.contains(request_id) {
            return Err("Tool execution aborted.".into());
        }

        Ok(())
    }

    pub fn finish(&self, request_id: Option<&str>) {
        if let Some(request_id) = request_id {
            self.clear(request_id);
        }
    }
}
