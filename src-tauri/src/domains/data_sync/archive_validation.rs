use rusqlite::Connection;
use std::collections::HashSet;
use std::io::{Cursor, Read};
use zip::ZipArchive;

use super::archive::CommandResult;

pub(super) const MAX_ARCHIVE_TOTAL_SIZE: u64 = 512 * 1024 * 1024;
pub(super) const MAX_CLIENT_STATE_SIZE: u64 = 8 * 1024 * 1024;
pub(super) const MAX_MANIFEST_SIZE: u64 = 64 * 1024;

const MAX_ARCHIVE_COMPRESSION_RATIO: u64 = 200;
pub(super) const ARCHIVE_BOOKS_PREFIX: &str = "books/";
pub(super) const ARCHIVE_SKILLS_PREFIX: &str = "skills/";

const REQUIRED_ARCHIVE_FILES: [&str; 3] = ["manifest.json", "client-state.json", "app.db"];
const MAX_ARCHIVE_ENTRIES: usize = 20_000;

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn is_valid_archive_path(name: &str) -> bool {
    if REQUIRED_ARCHIVE_FILES.contains(&name) {
        return true;
    }
    let Some(rest) = name
        .strip_prefix(ARCHIVE_BOOKS_PREFIX)
        .or_else(|| name.strip_prefix(ARCHIVE_SKILLS_PREFIX))
    else {
        return false;
    };
    let rest = rest.trim_end_matches('/');
    rest.is_empty()
        || (!rest.contains("//")
            && rest
                .split('/')
                .all(|segment| segment != "." && segment != ".." && !segment.contains('\\')))
}

fn canonical_archive_path(name: &str) -> String {
    for prefix in [ARCHIVE_BOOKS_PREFIX, ARCHIVE_SKILLS_PREFIX] {
        if let Some(rest) = name.strip_prefix(prefix) {
            let rest = rest.trim_end_matches('/');
            return if rest.is_empty() {
                prefix.to_string()
            } else {
                format!("{prefix}{rest}")
            };
        }
    }
    name.to_string()
}

pub(super) fn read_archive_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    max_size: u64,
) -> CommandResult<Vec<u8>> {
    let mut entry = archive.by_name(name).map_err(error_to_string)?;
    if entry.size() > max_size {
        return Err(format!("备份文件中的 {name} 超出大小限制。"));
    }

    let mut contents = Vec::new();
    let mut limited = entry.by_ref().take(max_size + 1);
    limited
        .read_to_end(&mut contents)
        .map_err(error_to_string)?;
    if contents.len() as u64 > max_size {
        return Err(format!("备份文件中的 {name} 超出大小限制。"));
    }
    Ok(contents)
}

pub(super) fn validate_archive_entries(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
) -> CommandResult<()> {
    if archive.is_empty() || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("备份文件结构不合法。".into());
    }

    let mut total_uncompressed = 0_u64;
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(error_to_string)?;
        let name = entry.name().to_string();
        if name.contains('\\') {
            return Err("备份文件结构不合法。".into());
        }
        if !is_valid_archive_path(&name) {
            return Err("备份文件结构不合法。".into());
        }
        if !names.insert(canonical_archive_path(&name)) {
            return Err("备份文件结构不合法。".into());
        }
        if entry.size() > MAX_ARCHIVE_TOTAL_SIZE {
            return Err("备份文件过大。".into());
        }
        if entry.compressed_size() > 0
            && entry.size() / entry.compressed_size().max(1) > MAX_ARCHIVE_COMPRESSION_RATIO
        {
            return Err("备份文件压缩比异常。".into());
        }
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_ARCHIVE_TOTAL_SIZE {
            return Err("备份文件过大。".into());
        }
    }

    Ok(())
}

pub(super) fn validate_restored_database(connection: &Connection) -> CommandResult<()> {
    // 技能/书籍已迁真实文件存储,其表不再属于 app.db,故不在校验清单内。
    for table_name in [
        "app_state",
        "chat_entries",
        "chat_sessions",
        "config_documents",
    ] {
        let exists = connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table_name],
                |_| Ok(()),
            )
            .is_ok();
        if !exists {
            return Err(format!("备份数据库缺少必要表：{table_name}。"));
        }
    }

    let integrity = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(error_to_string)?;
    if integrity != "ok" {
        return Err("备份数据库完整性校验失败。".into());
    }
    Ok(())
}
