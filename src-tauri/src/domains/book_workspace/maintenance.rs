// 图书工作区：打开旧书籍时补齐缺失的内置初始化模板（基于真实文件）。

use crate::domains::book_workspace::data::load_book_by_id;
use crate::domains::book_workspace::fs_store::WorkspaceStore;
use crate::domains::book_workspace::search::rebuild_book_search_index;
use crate::domains::book_workspace::templates::build_book_template;
use crate::infrastructure::workspace_paths::CommandResult;

pub(crate) fn ensure_book_workspace_template_db(
    store: &WorkspaceStore,
    book_id: &str,
) -> CommandResult<Vec<String>> {
    let book = load_book_by_id(store, book_id)?;
    let (directories, files) = build_book_template(&book.name);
    let mut created_paths = Vec::new();

    for directory in directories {
        if store.exists(&book.id, directory)? {
            if !store.is_dir(&book.id, directory)? {
                return Err(format!("初始化目录路径已被文件占用：{directory}"));
            }
        } else {
            store.create_dir(&book.id, directory)?;
            created_paths.push(directory.to_string());
        }
    }

    for (relative_path, contents) in files {
        if store.exists(&book.id, relative_path)? {
            if !store.is_file(&book.id, relative_path)? {
                return Err(format!("初始化文件路径已被目录占用：{relative_path}"));
            }
        } else {
            store.write_text(&book.id, relative_path, &contents)?;
            created_paths.push(relative_path.to_string());
        }
    }

    if !created_paths.is_empty() {
        rebuild_book_search_index(store, &book.id)?;
        store.touch(&book.id)?;
    }

    Ok(created_paths)
}
