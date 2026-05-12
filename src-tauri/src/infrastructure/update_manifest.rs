use reqwest::header::{ACCEPT, USER_AGENT};
use std::time::Duration;

type CommandResult<T> = Result<T, String>;

const UPDATE_MANIFEST_URL: &str = "https://pages.qgming.com/shenbi/app.json";

#[tauri::command]
pub async fn fetch_update_manifest() -> CommandResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(UPDATE_MANIFEST_URL)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "AiNovelStudio-Updater")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("读取最新版本失败（{}）。", status.as_u16()));
    }

    response.text().await.map_err(|error| error.to_string())
}
