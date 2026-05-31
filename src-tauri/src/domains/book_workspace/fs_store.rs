// 图书工作区：真实文件存储核心。
//
// CP-A 起，工作区文件从 SQLite BLOB 改为真实磁盘文件：
//   <books_root>/<book_id>/<relative_path>
// books_root 生产环境 = app_data_dir/books；测试环境注入 tempdir。
// 每本书自带一个 per-book 索引库 <book_id>/.index.db（FTS5 搜索 + 关联），
// 书目录里的 .meta.json 存书元信息（名称/时间戳）。
//
// 设计要点：
// - WorkspaceStore 是唯一的存储入口，持有 books_root，按 book_id 解析真实目录。
// - 所有路径都经 workspace_paths 的规范化与越界校验，沙盒边界落在 book 目录内。
// - .index.db 与 .meta.json 是工作区内部文件，不出现在用户可见的目录树里。

use crate::infrastructure::workspace_paths::{
    bytes_to_text, entry_name_from_path, error_to_string, file_extension, normalize_relative_path,
    now_timestamp, validate_relative_segments, CommandResult,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 工作区内部保留文件名（不计入用户可见目录树，也不索引）。
pub(crate) const META_FILE_NAME: &str = ".meta.json";
pub(crate) const INDEX_DB_NAME: &str = ".index.db";
/// 会话存储目录名：per-book 的 pi 会话 JSONL 落在 <book_id>/.sessions/ 下。
/// 与 .meta.json/.index.db 同属工作区内部保留名，不出现在用户目录树、不被索引。
pub(crate) const SESSIONS_DIR_NAME: &str = ".sessions";
/// 顶层展示用的虚拟根前缀（保持与旧 root_path 兼容：books/<书名>）。
pub(crate) const BOOK_ROOT_PREFIX: &str = "books";

fn is_reserved_internal_name(name: &str) -> bool {
    name == META_FILE_NAME || name == INDEX_DB_NAME || name == SESSIONS_DIR_NAME
}

/// 书元信息，序列化到 <book_id>/.meta.json。
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct BookMeta {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
}

/// 一条工作区目录项（文件或目录）。内容按需从磁盘读取，不再常驻内存。
#[derive(Clone)]
pub(crate) struct WorkspaceEntry {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) extension: Option<String>,
}

/// 真实文件工作区存储。books_root 之下每个子目录是一本书（目录名 = book_id）。
#[derive(Clone)]
pub(crate) struct WorkspaceStore {
    books_root: PathBuf,
}

impl WorkspaceStore {
    pub(crate) fn new(books_root: PathBuf) -> Self {
        Self { books_root }
    }

    /// 从 Tauri AppHandle 构造：books 根目录 = app_data_dir/books。
    pub(crate) fn from_app(app: &tauri::AppHandle) -> CommandResult<Self> {
        use tauri::Manager;
        let books_root = app
            .path()
            .app_data_dir()
            .map_err(error_to_string)?
            .join("books");
        fs::create_dir_all(&books_root).map_err(error_to_string)?;
        Ok(Self::new(books_root))
    }

    /// 某本书的真实目录：<books_root>/<book_id>。
    pub(crate) fn book_dir(&self, book_id: &str) -> PathBuf {
        self.books_root.join(book_id)
    }

    /// 某本书 per-book 索引库路径。
    pub(crate) fn index_db_path(&self, book_id: &str) -> PathBuf {
        self.book_dir(book_id).join(INDEX_DB_NAME)
    }

    pub(crate) fn meta_path(&self, book_id: &str) -> PathBuf {
        self.book_dir(book_id).join(META_FILE_NAME)
    }

    fn ensure_not_symlink(path: &Path) -> CommandResult<()> {
        if let Ok(metadata) = fs::symlink_metadata(path) {
            if metadata.file_type().is_symlink() {
                return Err("不能操作符号链接。".into());
            }
        }
        Ok(())
    }

    /// 解析路径并拒绝路径上所有已存在的 symlink。include_target=false 时仅检查父级。
    fn resolve_abs_no_symlink(
        &self,
        book_id: &str,
        relative_path: &str,
        include_target: bool,
    ) -> CommandResult<PathBuf> {
        let normalized = normalize_relative_path(relative_path)?;
        let book_dir = self.book_dir(book_id);
        Self::ensure_not_symlink(&book_dir)?;
        if normalized.is_empty() {
            return Ok(book_dir);
        }
        validate_relative_segments(&normalized)?;
        for segment in normalized.split('/') {
            if is_reserved_internal_name(segment) {
                return Err("不能操作工作区内部保留文件。".into());
            }
        }

        let mut current = book_dir;
        let segments = normalized.split('/').collect::<Vec<_>>();
        for (index, segment) in segments.iter().enumerate() {
            current.push(segment);
            if include_target || index + 1 < segments.len() {
                Self::ensure_not_symlink(&current)?;
            }
        }
        Ok(current)
    }

    // —— 书元信息 ——

    pub(crate) fn create_book_dir(&self, book_id: &str, meta: &BookMeta) -> CommandResult<()> {
        let dir = self.book_dir(book_id);
        fs::create_dir_all(&dir).map_err(error_to_string)?;
        self.write_meta(book_id, meta)
    }

    pub(crate) fn write_meta(&self, book_id: &str, meta: &BookMeta) -> CommandResult<()> {
        let json = serde_json::to_string_pretty(meta).map_err(error_to_string)?;
        fs::write(self.meta_path(book_id), json).map_err(error_to_string)
    }

    pub(crate) fn read_meta(&self, book_id: &str) -> CommandResult<BookMeta> {
        let raw = fs::read(self.meta_path(book_id)).map_err(|_| "目标书籍不存在。".to_string())?;
        serde_json::from_slice::<BookMeta>(&raw).map_err(error_to_string)
    }

    pub(crate) fn touch(&self, book_id: &str) -> CommandResult<()> {
        let mut meta = self.read_meta(book_id)?;
        meta.updated_at = now_timestamp();
        self.write_meta(book_id, &meta)
    }

    /// 列出所有书的元信息（扫描 books_root 子目录里的 .meta.json）。
    pub(crate) fn list_books(&self) -> CommandResult<Vec<BookMeta>> {
        let mut books = Vec::new();
        if !self.books_root.exists() {
            return Ok(books);
        }
        for item in fs::read_dir(&self.books_root).map_err(error_to_string)? {
            let item = item.map_err(error_to_string)?;
            if !item.file_type().map_err(error_to_string)?.is_dir() {
                continue;
            }
            let meta_path = item.path().join(META_FILE_NAME);
            if let Ok(raw) = fs::read(&meta_path) {
                if let Ok(meta) = serde_json::from_slice::<BookMeta>(&raw) {
                    books.push(meta);
                }
            }
        }
        books.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(books)
    }

    pub(crate) fn find_book_by_name(&self, name: &str) -> CommandResult<Option<BookMeta>> {
        Ok(self
            .list_books()?
            .into_iter()
            .find(|meta| meta.name == name))
    }

    pub(crate) fn delete_book(&self, book_id: &str) -> CommandResult<()> {
        let dir = self.book_dir(book_id);
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(error_to_string)?;
        }
        Ok(())
    }

    // —— 文件读写 ——

    pub(crate) fn exists(&self, book_id: &str, relative_path: &str) -> CommandResult<bool> {
        Ok(self
            .resolve_abs_no_symlink(book_id, relative_path, true)?
            .exists())
    }

    pub(crate) fn is_file(&self, book_id: &str, relative_path: &str) -> CommandResult<bool> {
        Ok(self
            .resolve_abs_no_symlink(book_id, relative_path, true)?
            .is_file())
    }

    pub(crate) fn is_dir(&self, book_id: &str, relative_path: &str) -> CommandResult<bool> {
        Ok(self
            .resolve_abs_no_symlink(book_id, relative_path, true)?
            .is_dir())
    }

    pub(crate) fn read_text(&self, book_id: &str, relative_path: &str) -> CommandResult<String> {
        let abs = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        if !abs.is_file() {
            return Err("只能读取文件内容。".into());
        }
        let bytes = fs::read(&abs).map_err(error_to_string)?;
        bytes_to_text(bytes)
    }

    pub(crate) fn read_bytes(&self, book_id: &str, relative_path: &str) -> CommandResult<Vec<u8>> {
        let abs = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        fs::read(&abs).map_err(error_to_string)
    }

    /// 写文件（覆盖），自动创建父目录。relative_path 为空则报错。
    pub(crate) fn write_text(
        &self,
        book_id: &str,
        relative_path: &str,
        contents: &str,
    ) -> CommandResult<()> {
        self.write_bytes(book_id, relative_path, contents.as_bytes())
    }

    pub(crate) fn write_bytes(
        &self,
        book_id: &str,
        relative_path: &str,
        bytes: &[u8],
    ) -> CommandResult<()> {
        let abs = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        if abs == self.book_dir(book_id) {
            return Err("只能写入文件内容。".into());
        }
        if abs.is_dir() {
            return Err("只能写入文件内容。".into());
        }
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        fs::write(&abs, bytes).map_err(error_to_string)
    }

    pub(crate) fn create_dir(&self, book_id: &str, relative_path: &str) -> CommandResult<()> {
        let abs = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        fs::create_dir_all(&abs).map_err(error_to_string)
    }

    pub(crate) fn remove(&self, book_id: &str, relative_path: &str) -> CommandResult<()> {
        let abs = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        if abs == self.book_dir(book_id) {
            return Err("不能删除书籍根目录。".into());
        }
        if !abs.exists() {
            return Err("目标路径不存在。".into());
        }
        if abs.is_dir() {
            fs::remove_dir_all(&abs).map_err(error_to_string)
        } else {
            fs::remove_file(&abs).map_err(error_to_string)
        }
    }

    pub(crate) fn rename(
        &self,
        book_id: &str,
        relative_path: &str,
        target_relative_path: &str,
    ) -> CommandResult<()> {
        let from = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        let to = self.resolve_abs_no_symlink(book_id, target_relative_path, true)?;
        if !from.exists() {
            return Err("目标路径不存在。".into());
        }
        if to.exists() {
            return Err("目标名称已存在。".into());
        }
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        fs::rename(&from, &to).map_err(error_to_string)
    }

    /// 列某目录的直接子项（不含内部保留文件），返回 WorkspaceEntry。
    pub(crate) fn list_dir(
        &self,
        book_id: &str,
        relative_path: &str,
    ) -> CommandResult<Vec<WorkspaceEntry>> {
        let abs = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        if !abs.is_dir() {
            return Err("只能列出目录内容。".into());
        }
        let parent_rel = normalize_relative_path(relative_path)?;
        let mut entries = Vec::new();
        for item in fs::read_dir(&abs).map_err(error_to_string)? {
            let item = item.map_err(error_to_string)?;
            let name = item.file_name().to_string_lossy().to_string();
            if is_reserved_internal_name(&name) {
                continue;
            }
            let file_type = item.file_type().map_err(error_to_string)?;
            if file_type.is_symlink() {
                continue;
            }
            let child_rel = if parent_rel.is_empty() {
                name.clone()
            } else {
                format!("{parent_rel}/{name}")
            };
            let kind = if file_type.is_dir() {
                "directory"
            } else {
                "file"
            };
            entries.push(WorkspaceEntry {
                extension: if kind == "file" {
                    file_extension(&name)
                } else {
                    None
                },
                kind: kind.to_string(),
                name,
                path: child_rel,
            });
        }
        Ok(entries)
    }

    /// 递归收集书内全部条目（深度优先，跳过内部保留文件），供索引重建使用。
    pub(crate) fn collect_all_entries(&self, book_id: &str) -> CommandResult<Vec<WorkspaceEntry>> {
        let mut entries = Vec::new();
        self.collect_into(book_id, "", &mut entries)?;
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(entries)
    }

    /// 收集某条路径（含其子树）下的全部条目，供子树增量重建索引使用。
    /// - root 为文件：返回仅含该文件一项；
    /// - root 为目录：返回该目录自身 + 其全部后代；
    /// - root 不存在：返回空（调用方据此只做删除）。
    pub(crate) fn collect_subtree_entries(
        &self,
        book_id: &str,
        root: &str,
    ) -> CommandResult<Vec<WorkspaceEntry>> {
        let Some(root_entry) = self.entry_record(book_id, root)? else {
            return Ok(Vec::new());
        };
        let is_dir = root_entry.kind == "directory";
        let root_path = root_entry.path.clone();
        let mut entries = vec![root_entry];
        if is_dir {
            self.collect_into(book_id, &root_path, &mut entries)?;
        }
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(entries)
    }

    fn collect_into(
        &self,
        book_id: &str,
        relative_path: &str,
        out: &mut Vec<WorkspaceEntry>,
    ) -> CommandResult<()> {
        for entry in self.list_dir(book_id, relative_path)? {
            let is_dir = entry.kind == "directory";
            let child_path = entry.path.clone();
            out.push(entry);
            if is_dir {
                self.collect_into(book_id, &child_path, out)?;
            }
        }
        Ok(())
    }

    pub(crate) fn entry_record(
        &self,
        book_id: &str,
        relative_path: &str,
    ) -> CommandResult<Option<WorkspaceEntry>> {
        let abs = self.resolve_abs_no_symlink(book_id, relative_path, true)?;
        if !abs.exists() {
            return Ok(None);
        }
        let normalized = normalize_relative_path(relative_path)?;
        let name = if normalized.is_empty() {
            String::new()
        } else {
            entry_name_from_path(&normalized)?
        };
        let kind = if abs.is_dir() { "directory" } else { "file" };
        Ok(Some(WorkspaceEntry {
            extension: if kind == "file" {
                file_extension(&name)
            } else {
                None
            },
            kind: kind.to_string(),
            name,
            path: normalized,
        }))
    }

    // —— per-book 索引库 ——

    /// 打开（必要时创建）某本书的 .index.db，并确保索引/关联表存在。
    pub(crate) fn open_index(&self, book_id: &str) -> CommandResult<Connection> {
        let dir = self.book_dir(book_id);
        fs::create_dir_all(&dir).map_err(error_to_string)?;
        let connection = Connection::open(self.index_db_path(book_id)).map_err(error_to_string)?;
        crate::domains::book_workspace::index_schema::ensure_index_schema(&connection)?;
        Ok(connection)
    }

    // —— per-book 会话存储（<book_id>/.sessions/，供 pi JsonlSessionRepo 落盘）——

    /// 会话目录根：<book_id>/.sessions。
    pub(crate) fn sessions_dir(&self, book_id: &str) -> PathBuf {
        self.book_dir(book_id).join(SESSIONS_DIR_NAME)
    }

    /// 把会话相对路径安全解析为 .sessions 内的真实绝对路径，拒绝 .. 越界。
    /// 与 resolve_abs 不同：允许（实际上要求）落在保留目录 .sessions 内。
    fn resolve_session_abs(&self, book_id: &str, relative_path: &str) -> CommandResult<PathBuf> {
        let normalized = normalize_relative_path(relative_path)?;
        let mut abs = self.sessions_dir(book_id);
        Self::ensure_not_symlink(&self.book_dir(book_id))?;
        Self::ensure_not_symlink(&abs)?;
        if normalized.is_empty() {
            return Ok(abs);
        }
        validate_relative_segments(&normalized)?;
        let segments = normalized.split('/').collect::<Vec<_>>();
        for (index, segment) in segments.iter().enumerate() {
            abs.push(segment);
            if index + 1 < segments.len() || abs.exists() {
                Self::ensure_not_symlink(&abs)?;
            }
        }
        Ok(abs)
    }

    pub(crate) fn session_exists(&self, book_id: &str, relative_path: &str) -> CommandResult<bool> {
        Ok(self.resolve_session_abs(book_id, relative_path)?.exists())
    }

    pub(crate) fn session_read(&self, book_id: &str, relative_path: &str) -> CommandResult<String> {
        let abs = self.resolve_session_abs(book_id, relative_path)?;
        let bytes = fs::read(&abs).map_err(|_| "会话文件不存在。".to_string())?;
        bytes_to_text(bytes)
    }

    pub(crate) fn session_write(
        &self,
        book_id: &str,
        relative_path: &str,
        contents: &str,
    ) -> CommandResult<()> {
        let abs = self.resolve_session_abs(book_id, relative_path)?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        fs::write(&abs, contents).map_err(error_to_string)
    }

    pub(crate) fn session_append(
        &self,
        book_id: &str,
        relative_path: &str,
        contents: &str,
    ) -> CommandResult<()> {
        use std::io::Write;
        let abs = self.resolve_session_abs(book_id, relative_path)?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&abs)
            .map_err(error_to_string)?;
        file.write_all(contents.as_bytes()).map_err(error_to_string)
    }

    pub(crate) fn session_create_dir(
        &self,
        book_id: &str,
        relative_path: &str,
    ) -> CommandResult<()> {
        let abs = self.resolve_session_abs(book_id, relative_path)?;
        fs::create_dir_all(&abs).map_err(error_to_string)
    }

    pub(crate) fn session_remove(&self, book_id: &str, relative_path: &str) -> CommandResult<()> {
        let abs = self.resolve_session_abs(book_id, relative_path)?;
        if !abs.exists() {
            return Ok(());
        }
        if abs.is_dir() {
            fs::remove_dir_all(&abs).map_err(error_to_string)
        } else {
            fs::remove_file(&abs).map_err(error_to_string)
        }
    }

    /// 列会话目录的直接子项：返回 (name, is_dir)。目录不存在则返回空。
    pub(crate) fn session_list_dir(
        &self,
        book_id: &str,
        relative_path: &str,
    ) -> CommandResult<Vec<(String, bool)>> {
        let abs = self.resolve_session_abs(book_id, relative_path)?;
        if !abs.is_dir() {
            return Ok(Vec::new());
        }
        let mut items = Vec::new();
        for item in fs::read_dir(&abs).map_err(error_to_string)? {
            let item = item.map_err(error_to_string)?;
            let name = item.file_name().to_string_lossy().to_string();
            let is_dir = item.file_type().map_err(error_to_string)?.is_dir();
            items.push((name, is_dir));
        }
        Ok(items)
    }
}
