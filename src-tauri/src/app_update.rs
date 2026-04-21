use reqwest::header::{ACCEPT, HeaderMap, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub type CommandResult<T> = Result<T, String>;

const GITHUB_API_VERSION: &str = "2022-11-28";
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/qgming/ainovelstudio/releases/latest";

#[derive(Deserialize)]
struct GithubReleaseAssetPayload {
    browser_download_url: String,
    content_type: Option<String>,
    name: String,
    size: u64,
}

#[derive(Deserialize)]
struct GithubReleasePayload {
    assets: Vec<GithubReleaseAssetPayload>,
    body: Option<String>,
    draft: bool,
    html_url: String,
    name: Option<String>,
    prerelease: bool,
    published_at: Option<String>,
    tag_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAssetSummary {
    pub content_type: String,
    pub download_url: String,
    pub name: String,
    pub size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestReleaseInfo {
    pub assets: Vec<ReleaseAssetSummary>,
    pub body: String,
    pub draft: bool,
    pub html_url: String,
    pub name: String,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub tag_name: String,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn build_headers(app: &AppHandle) -> CommandResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let user_agent = format!("AiNovelStudio/{}", app.package_info().version);
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(&user_agent).map_err(error_to_string)?,
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static(GITHUB_API_VERSION),
    );
    Ok(headers)
}

fn map_release(payload: GithubReleasePayload) -> LatestReleaseInfo {
    LatestReleaseInfo {
        assets: payload
            .assets
            .into_iter()
            .map(|asset| ReleaseAssetSummary {
                content_type: asset.content_type.unwrap_or_default(),
                download_url: asset.browser_download_url,
                name: asset.name,
                size: asset.size,
            })
            .collect(),
        body: payload.body.unwrap_or_default(),
        draft: payload.draft,
        html_url: payload.html_url,
        name: payload.name.unwrap_or_default(),
        prerelease: payload.prerelease,
        published_at: payload.published_at,
        tag_name: payload.tag_name,
    }
}

async fn request_latest_release(app: &AppHandle) -> CommandResult<GithubReleasePayload> {
    let client = reqwest::Client::builder()
        .default_headers(build_headers(app)?)
        .build()
        .map_err(error_to_string)?;
    let response = client
        .get(LATEST_RELEASE_URL)
        .send()
        .await
        .map_err(error_to_string)?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("GitHub Releases 中还没有可用版本。".into());
    }

    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("GitHub API 请求被限制，请稍后重试。".into());
    }

    if !response.status().is_success() {
        return Err(format!("检查更新失败：HTTP {}", response.status()));
    }

    response.json::<GithubReleasePayload>().await.map_err(error_to_string)
}

#[tauri::command]
pub async fn fetch_latest_release_info(app: AppHandle) -> CommandResult<LatestReleaseInfo> {
    request_latest_release(&app).await.map(map_release)
}
