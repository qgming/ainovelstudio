use reqwest::{Client, RequestBuilder, StatusCode, Url};

use super::{CommandResult, DataSyncSettingsDocument};

const REMOTE_ARCHIVE_FILE: &str = "ainovelstudio-sync.zip";

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn build_client() -> CommandResult<Client> {
    Client::builder().build().map_err(error_to_string)
}

fn normalize_remote_segments(value: &str) -> Vec<String> {
    value
        .split('/')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn build_collection_url(server_url: &str, remote_path: &str) -> CommandResult<Url> {
    let mut normalized_server_url = server_url.trim().to_string();
    if normalized_server_url.is_empty() {
        return Err("请填写 WebDAV 地址。".into());
    }
    if !normalized_server_url.ends_with('/') {
        normalized_server_url.push('/');
    }

    let mut url = Url::parse(&normalized_server_url).map_err(error_to_string)?;
    for segment in normalize_remote_segments(remote_path) {
        url = url.join(&format!("{segment}/")).map_err(error_to_string)?;
    }
    Ok(url)
}

fn build_archive_url(server_url: &str, remote_path: &str) -> CommandResult<Url> {
    build_collection_url(server_url, remote_path)?
        .join(REMOTE_ARCHIVE_FILE)
        .map_err(error_to_string)
}

fn with_auth(builder: RequestBuilder, settings: &DataSyncSettingsDocument) -> RequestBuilder {
    let username = settings.username.trim();
    if username.is_empty() {
        builder
    } else {
        builder.basic_auth(username.to_string(), Some(settings.password.clone()))
    }
}

fn collection_status_is_ok(status: StatusCode) -> bool {
    status.is_success() || status == StatusCode::METHOD_NOT_ALLOWED
}

#[derive(Clone)]
pub struct WebdavProbeResult {
    pub ok: bool,
    pub message: String,
}

async fn ensure_remote_collection(
    client: &Client,
    settings: &DataSyncSettingsDocument,
) -> CommandResult<()> {
    let root_collection = build_collection_url(&settings.server_url, "")?;
    let mut current = root_collection;

    for segment in normalize_remote_segments(&settings.remote_path) {
        current = current
            .join(&format!("{segment}/"))
            .map_err(error_to_string)?;
        let response = with_auth(
            client.request(
                reqwest::Method::from_bytes(b"MKCOL").map_err(error_to_string)?,
                current.clone(),
            ),
            settings,
        )
        .send()
        .await
        .map_err(error_to_string)?;

        if !collection_status_is_ok(response.status()) {
            return Err(format!("创建 WebDAV 目录失败：{}", response.status()));
        }
    }

    Ok(())
}

pub async fn fetch_remote_archive(
    settings: &DataSyncSettingsDocument,
) -> CommandResult<Option<Vec<u8>>> {
    let client = build_client()?;
    let url = build_archive_url(&settings.server_url, &settings.remote_path)?;
    let response = with_auth(client.get(url), settings)
        .send()
        .await
        .map_err(error_to_string)?;

    if matches!(
        response.status(),
        StatusCode::NOT_FOUND | StatusCode::CONFLICT
    ) {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("读取云端备份失败：{}", response.status()));
    }

    response
        .bytes()
        .await
        .map(|bytes| Some(bytes.to_vec()))
        .map_err(error_to_string)
}

pub async fn probe_connection(
    settings: &DataSyncSettingsDocument,
) -> CommandResult<WebdavProbeResult> {
    let client = build_client()?;
    let root_url = build_collection_url(&settings.server_url, "")?;
    let root_response = with_auth(client.get(root_url), settings)
        .send()
        .await
        .map_err(error_to_string)?;

    let root_status = root_response.status();
    if !root_status.is_success() && root_status != StatusCode::METHOD_NOT_ALLOWED {
        return Ok(WebdavProbeResult {
            ok: false,
            message: format!("连接失败（{}）", root_status.as_u16()),
        });
    }

    let collection_url = build_collection_url(&settings.server_url, &settings.remote_path)?;
    let collection_response = with_auth(client.get(collection_url), settings)
        .send()
        .await
        .map_err(error_to_string)?;
    let collection_status = collection_response.status();

    if collection_status.is_success() || collection_status == StatusCode::METHOD_NOT_ALLOWED {
        return Ok(WebdavProbeResult {
            ok: true,
            message: "连接成功".into(),
        });
    }

    if matches!(
        collection_status,
        StatusCode::NOT_FOUND | StatusCode::CONFLICT
    ) {
        return Ok(WebdavProbeResult {
            ok: true,
            message: "连接成功，远端目录将在首次同步时自动创建。".into(),
        });
    }

    Ok(WebdavProbeResult {
        ok: false,
        message: format!("连接失败（{}）", collection_status.as_u16()),
    })
}

pub async fn upload_remote_archive(
    settings: &DataSyncSettingsDocument,
    archive_bytes: &[u8],
) -> CommandResult<()> {
    let client = build_client()?;
    ensure_remote_collection(&client, settings).await?;
    let url = build_archive_url(&settings.server_url, &settings.remote_path)?;
    let response = with_auth(client.put(url).body(archive_bytes.to_vec()), settings)
        .header("content-type", "application/zip")
        .send()
        .await
        .map_err(error_to_string)?;

    if !response.status().is_success() {
        return Err(format!("上传云端备份失败：{}", response.status()));
    }

    Ok(())
}
