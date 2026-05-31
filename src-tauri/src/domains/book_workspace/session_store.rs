// 图书工作区：per-book 会话存储（.sessions/）的 DB 层函数。
//
// CP-C 起，AI 会话改由 pi AgentHarness 的 JsonlSessionRepo 持久化。pi 要的是一个
// FileSystem 后端 + sessionsRoot；前端无文件系统权限，故由这组 session_fs_* 命令
// 把 pi 的文件读写转发到真实磁盘的 <book_id>/.sessions/ 目录。
//
// 设计要点：
// - 所有路径都相对 .sessions/，经 resolve_session_abs 做 .. 越界校验，锁在该目录内。
// - 会话目录是工作区内部保留名（见 fs_store），不进用户目录树、不被搜索索引扫到。
// - 删书 = 删 <book_id>/ 整目录，会话随书自动清理。

use crate::domains::book_workspace::data::load_book_by_id;
use crate::domains::book_workspace::fs_store::WorkspaceStore;
use crate::infrastructure::workspace_paths::CommandResult;
use serde::Serialize;

/// 会话目录项：name + 是否目录。供 TS 侧合成 pi FileInfo。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    pub(crate) name: String,
    pub(crate) is_dir: bool,
}

pub(crate) fn session_exists_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<bool> {
    let book = load_book_by_id(store, book_id)?;
    store.session_exists(&book.id, path)
}

pub(crate) fn session_read_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<String> {
    let book = load_book_by_id(store, book_id)?;
    store.session_read(&book.id, path)
}

pub(crate) fn session_write_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    contents: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    store.session_write(&book.id, path, contents)
}

pub(crate) fn session_append_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    contents: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    store.session_append(&book.id, path, contents)
}

pub(crate) fn session_create_dir_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    store.session_create_dir(&book.id, path)
}

pub(crate) fn session_remove_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    store.session_remove(&book.id, path)
}

pub(crate) fn session_list_dir_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<Vec<SessionEntry>> {
    let book = load_book_by_id(store, book_id)?;
    Ok(store
        .session_list_dir(&book.id, path)?
        .into_iter()
        .map(|(name, is_dir)| SessionEntry { name, is_dir })
        .collect())
}
