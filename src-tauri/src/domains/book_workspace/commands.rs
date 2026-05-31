// 图书工作区：Tauri 命令入口（基于真实文件存储）。

use crate::app::ToolCancellationRegistry;
use crate::domains::book_workspace::archive::{export_book_zip_db, import_book_zip_db};
use crate::domains::book_workspace::data::{
    build_summary, list_books, load_book_by_id, BookWorkspaceSummary, TreeNode, WorkspaceLineResult,
};
use crate::domains::book_workspace::fs_store::WorkspaceStore;
use crate::domains::book_workspace::maintenance::ensure_book_workspace_template_db;
use crate::domains::book_workspace::ops::{
    create_workspace_directory_db, create_workspace_text_file_db, delete_workspace_entry_db,
    edit_text_file_db, move_workspace_entry_db, read_text_file_db, read_text_file_line_db,
    rename_workspace_entry_db, replace_text_file_line_db, write_text_file_db,
};
use crate::domains::book_workspace::relations::{
    create_relation_by_root, delete_relation_by_root, list_book_relations_by_root,
    list_entry_relations_by_root, update_relation_by_root, RelationDto,
};
use crate::domains::book_workspace::search::{
    grep_workspace_content_db, search_workspace_content_db, WorkspaceGrepResult,
    WorkspaceSearchResult,
};
use crate::domains::book_workspace::session_store::{
    session_append_db, session_create_dir_db, session_exists_db, session_list_dir_db,
    session_read_db, session_remove_db, session_write_db, SessionEntry,
};
use crate::domains::book_workspace::templates::create_book_workspace_db;
use crate::domains::book_workspace::tree::read_workspace_tree_db;
use crate::infrastructure::workspace_paths::{check_cancellation, with_cancellable_request};
use std::path::Path;
use tauri::{AppHandle, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

type CommandResult<T> = Result<T, String>;

fn store(app: &AppHandle) -> CommandResult<WorkspaceStore> {
    WorkspaceStore::from_app(app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn cancel_tool_request(
    requestId: String,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    registry.cancel(&requestId);
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn cancel_tool_requests(
    requestIds: Vec<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    for request_id in requestIds {
        registry.cancel(&request_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_book_directory(app: AppHandle) -> CommandResult<Option<String>> {
    #[cfg(desktop)]
    {
        Ok(app
            .dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().replace('\\', "/")))
    }

    #[cfg(mobile)]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn open_book_folder(app: AppHandle, bookId: String) -> CommandResult<()> {
    #[cfg(desktop)]
    {
        use tauri_plugin_opener::OpenerExt;
        let store = store(&app)?;
        let book = load_book_by_id(&store, &bookId)?;
        let dir = store.book_dir(&book.id);
        app.opener()
            .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|error| error.to_string())
    }

    #[cfg(mobile)]
    {
        let _ = (app, bookId);
        Err("当前平台暂不支持打开系统文件资源管理器。".into())
    }
}

#[tauri::command]
pub fn list_book_workspaces(app: AppHandle) -> CommandResult<Vec<BookWorkspaceSummary>> {
    let store = store(&app)?;
    Ok(list_books(&store)?
        .into_iter()
        .map(|book| build_summary(&book))
        .collect())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary(
    app: AppHandle,
    bookId: String,
) -> CommandResult<BookWorkspaceSummary> {
    let store = store(&app)?;
    load_book_by_id(&store, &bookId).map(|book| build_summary(&book))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary_by_id(
    app: AppHandle,
    bookId: String,
) -> CommandResult<BookWorkspaceSummary> {
    let store = store(&app)?;
    load_book_by_id(&store, &bookId).map(|book| build_summary(&book))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_book_workspace(
    app: AppHandle,
    parentPath: Option<String>,
    bookName: String,
) -> CommandResult<BookWorkspaceSummary> {
    if parentPath
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return Err("当前版本仅支持写入内置书库目录。".into());
    }

    let store = store(&app)?;
    create_book_workspace_db(&store, &bookName).map(|book| build_summary(&book))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_book_zip(
    app: AppHandle,
    fileName: String,
    archiveBytes: Vec<u8>,
) -> CommandResult<BookWorkspaceSummary> {
    if Path::new(&fileName)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err("仅支持导入 .zip 书籍包。".into());
    }
    if archiveBytes.is_empty() {
        return Err("ZIP 压缩包为空。".into());
    }

    let store = store(&app)?;
    import_book_zip_db(&store, &fileName, archiveBytes).map(|book| build_summary(&book))
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_book_zip(app: AppHandle, bookId: String) -> CommandResult<Option<String>> {
    let archive_bytes = {
        let store = store(&app)?;
        export_book_zip_db(&store, &bookId)?
    };

    #[cfg(desktop)]
    {
        let store = store(&app)?;
        let default_file_name = format!("{}.zip", load_book_by_id(&store, &bookId)?.name);
        let save_path = app
            .dialog()
            .file()
            .set_file_name(&default_file_name)
            .add_filter("ZIP 压缩包", &["zip"])
            .blocking_save_file()
            .and_then(|path| path.into_path().ok());
        let Some(save_path) = save_path else {
            return Ok(None);
        };

        let final_path = if save_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("zip"))
            == Some(true)
        {
            save_path
        } else {
            save_path.with_extension("zip")
        };

        std::fs::write(&final_path, archive_bytes).map_err(|error| error.to_string())?;
        Ok(Some(final_path.to_string_lossy().replace('\\', "/")))
    }

    #[cfg(mobile)]
    {
        let _ = (app, archive_bytes);
        Err("当前平台暂不支持导出 ZIP 书籍包。".into())
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_book_workspace(app: AppHandle, bookId: String) -> CommandResult<()> {
    let store = store(&app)?;
    let book = load_book_by_id(&store, &bookId)?;
    store.delete_book(&book.id)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn ensure_book_workspace_template(
    app: AppHandle,
    bookId: String,
) -> CommandResult<Vec<String>> {
    let store = store(&app)?;
    ensure_book_workspace_template_db(&store, &bookId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_workspace_tree(
    app: AppHandle,
    bookId: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<TreeNode> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        read_workspace_tree_db(&store, &bookId)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file(
    app: AppHandle,
    bookId: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        read_text_file_db(&store, &bookId, &path)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_text_file(
    app: AppHandle,
    bookId: String,
    path: String,
    contents: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        write_text_file_db(&store, &bookId, &path, &contents)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub fn edit_text_file(
    app: AppHandle,
    bookId: String,
    path: String,
    oldString: String,
    newString: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        edit_text_file_db(&store, &bookId, &path, &oldString, &newString)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub fn search_workspace_content(
    app: AppHandle,
    bookId: String,
    query: String,
    limit: Option<usize>,
    intent: Option<String>,
    scope: Option<Vec<String>>,
    tokenBudget: Option<usize>,
    includeAdjacent: Option<bool>,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceSearchResult> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        let store = store(&app)?;
        search_workspace_content_db(
            &store,
            &bookId,
            &query,
            limit,
            intent.as_deref(),
            scope,
            tokenBudget,
            includeAdjacent,
            &registry,
            requestId.as_deref(),
        )
    })
}

#[tauri::command]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub fn grep_workspace_content(
    app: AppHandle,
    bookId: String,
    pattern: String,
    isRegex: Option<bool>,
    caseSensitive: Option<bool>,
    scope: Option<Vec<String>>,
    limit: Option<usize>,
    contextLines: Option<usize>,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceGrepResult> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        let store = store(&app)?;
        grep_workspace_content_db(
            &store,
            &bookId,
            &pattern,
            isRegex,
            caseSensitive,
            scope,
            limit,
            contextLines,
            &registry,
            requestId.as_deref(),
        )
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file_line(
    app: AppHandle,
    bookId: String,
    path: String,
    lineNumber: usize,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceLineResult> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        read_text_file_line_db(&store, &bookId, &path, lineNumber)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub fn replace_text_file_line(
    app: AppHandle,
    bookId: String,
    path: String,
    lineNumber: usize,
    contents: String,
    previousLine: Option<String>,
    nextLine: Option<String>,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceLineResult> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        replace_text_file_line_db(
            &store,
            &bookId,
            &path,
            lineNumber,
            &contents,
            previousLine,
            nextLine,
        )
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_directory(
    app: AppHandle,
    bookId: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        create_workspace_directory_db(&store, &bookId, &parentPath, &name)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_text_file(
    app: AppHandle,
    bookId: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        create_workspace_text_file_db(&store, &bookId, &parentPath, &name)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn rename_workspace_entry(
    app: AppHandle,
    bookId: String,
    path: String,
    nextName: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        rename_workspace_entry_db(&store, &bookId, &path, &nextName)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn move_workspace_entry(
    app: AppHandle,
    bookId: String,
    path: String,
    targetParentPath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        move_workspace_entry_db(&store, &bookId, &path, &targetParentPath)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_workspace_entry(
    app: AppHandle,
    bookId: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let store = store(&app)?;
        delete_workspace_entry_db(&store, &bookId, &path)
    })
}

// —— 文件关联(无向多对多)相关命令 ——

#[tauri::command]
#[allow(non_snake_case)]
pub fn list_entry_relations(
    app: AppHandle,
    bookId: String,
    entryPath: String,
) -> CommandResult<Vec<RelationDto>> {
    let store = store(&app)?;
    list_entry_relations_by_root(&store, &bookId, &entryPath)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn list_book_relations(app: AppHandle, bookId: String) -> CommandResult<Vec<RelationDto>> {
    let store = store(&app)?;
    list_book_relations_by_root(&store, &bookId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_entry_relation(
    app: AppHandle,
    bookId: String,
    entryAPath: String,
    entryBPath: String,
    relationship: String,
    note: Option<String>,
) -> CommandResult<RelationDto> {
    let store = store(&app)?;
    create_relation_by_root(
        &store,
        &bookId,
        &entryAPath,
        &entryBPath,
        &relationship,
        note.as_deref(),
    )
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_entry_relation(
    app: AppHandle,
    bookId: String,
    relationId: String,
    relationship: Option<String>,
    note: Option<String>,
    clearNote: Option<bool>,
) -> CommandResult<RelationDto> {
    // note 三态：两者缺省→不改；clearNote=true→清空；note=Some(x)→改为 x。
    let note_arg: Option<Option<&str>> = if clearNote.unwrap_or(false) {
        Some(None)
    } else {
        note.as_deref().map(Some)
    };

    let store = store(&app)?;
    update_relation_by_root(
        &store,
        &bookId,
        &relationId,
        relationship.as_deref(),
        note_arg,
    )
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_entry_relation(
    app: AppHandle,
    bookId: String,
    relationId: String,
) -> CommandResult<()> {
    let store = store(&app)?;
    delete_relation_by_root(&store, &bookId, &relationId)
}

// —— per-book 会话存储（.sessions/）：供 pi AgentHarness 的 JsonlSessionRepo 落盘 ——
// path 均相对 .sessions/，由后端做 .. 越界校验并锁在该目录内。

#[tauri::command]
#[allow(non_snake_case)]
pub fn session_fs_exists(app: AppHandle, bookId: String, path: String) -> CommandResult<bool> {
    let store = store(&app)?;
    session_exists_db(&store, &bookId, &path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn session_fs_read(app: AppHandle, bookId: String, path: String) -> CommandResult<String> {
    let store = store(&app)?;
    session_read_db(&store, &bookId, &path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn session_fs_write(
    app: AppHandle,
    bookId: String,
    path: String,
    contents: String,
) -> CommandResult<()> {
    let store = store(&app)?;
    session_write_db(&store, &bookId, &path, &contents)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn session_fs_append(
    app: AppHandle,
    bookId: String,
    path: String,
    contents: String,
) -> CommandResult<()> {
    let store = store(&app)?;
    session_append_db(&store, &bookId, &path, &contents)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn session_fs_create_dir(app: AppHandle, bookId: String, path: String) -> CommandResult<()> {
    let store = store(&app)?;
    session_create_dir_db(&store, &bookId, &path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn session_fs_remove(app: AppHandle, bookId: String, path: String) -> CommandResult<()> {
    let store = store(&app)?;
    session_remove_db(&store, &bookId, &path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn session_fs_list_dir(
    app: AppHandle,
    bookId: String,
    path: String,
) -> CommandResult<Vec<SessionEntry>> {
    let store = store(&app)?;
    session_list_dir_db(&store, &bookId, &path)
}
