// 图书工作区：Tauri 命令入口。

use crate::app::ToolCancellationRegistry;
use crate::domains::book_workspace::archive::{export_book_zip_db, import_book_zip_db};
use crate::domains::book_workspace::data::{
    build_summary, list_books, load_book_by_id, load_book_by_root_path, BookWorkspaceSummary,
    TreeNode, WorkspaceLineResult,
};
use crate::domains::book_workspace::maintenance::ensure_book_workspace_template_db;
#[cfg(desktop)]
use crate::domains::book_workspace::mirror::{
    export_book_to_mirror, import_changed_mirror_to_book, import_mirror_to_book,
};
use crate::domains::book_workspace::ops::{
    create_workspace_directory_db, create_workspace_text_file_db, delete_workspace_entry_db,
    move_workspace_entry_db, read_text_file_db, read_text_file_line_db, rename_workspace_entry_db,
    replace_text_file_line_db, write_text_file_db,
};
use crate::domains::book_workspace::relations::{
    create_relation_by_root, delete_relation_by_root, list_book_relations_by_root,
    list_entry_relations_by_root, update_relation_by_root, RelationDto,
};
use crate::domains::book_workspace::search::{
    delete_book_search_index, search_workspace_content_db, WorkspaceSearchResult,
};
use crate::domains::book_workspace::templates::create_book_workspace_db;
use crate::domains::book_workspace::tree::read_workspace_tree_db;
use crate::infrastructure::db::open_database;
use crate::infrastructure::workspace_paths::{
    check_cancellation, error_to_string, with_cancellable_request, CommandResult,
};
use rusqlite::{params, Transaction, TransactionBehavior};
use std::path::Path;
use tauri::{AppHandle, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

fn with_transaction<T, F>(app: &AppHandle, operation: F) -> CommandResult<T>
where
    F: FnOnce(&Transaction<'_>) -> CommandResult<T>,
{
    let mut connection = open_database(app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error_to_string)?;
    let result = operation(&transaction)?;
    transaction.commit().map_err(error_to_string)?;
    Ok(result)
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
pub fn open_book_folder(app: AppHandle, rootPath: String) -> CommandResult<()> {
    #[cfg(desktop)]
    {
        use tauri_plugin_opener::OpenerExt;

        let connection = open_database(&app)?;
        let mirror_path = export_book_to_mirror(&app, &connection, &rootPath)?;
        app.opener()
            .open_path(mirror_path.to_string_lossy().into_owned(), None::<&str>)
            .map_err(error_to_string)
    }

    #[cfg(mobile)]
    {
        let _ = app;
        let _ = rootPath;
        Err("当前平台暂不支持打开系统文件资源管理器。".into())
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn sync_book_folder_to_workspace(app: AppHandle, rootPath: String) -> CommandResult<bool> {
    #[cfg(desktop)]
    {
        with_transaction(&app, |transaction| {
            import_mirror_to_book(&app, transaction, &rootPath)
        })
    }

    #[cfg(mobile)]
    {
        let _ = app;
        let _ = rootPath;
        Ok(false)
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn sync_changed_book_folder_to_workspace(
    app: AppHandle,
    rootPath: String,
) -> CommandResult<bool> {
    #[cfg(desktop)]
    {
        with_transaction(&app, |transaction| {
            import_changed_mirror_to_book(&app, transaction, &rootPath)
        })
    }

    #[cfg(mobile)]
    {
        let _ = app;
        let _ = rootPath;
        Ok(false)
    }
}

#[tauri::command]
pub fn list_book_workspaces(app: AppHandle) -> CommandResult<Vec<BookWorkspaceSummary>> {
    let connection = open_database(&app)?;
    Ok(list_books(&connection)?
        .into_iter()
        .map(|book| build_summary(&book))
        .collect())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary(
    app: AppHandle,
    rootPath: String,
) -> CommandResult<BookWorkspaceSummary> {
    let connection = open_database(&app)?;
    load_book_by_root_path(&connection, &rootPath).map(|book| build_summary(&book))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary_by_id(
    app: AppHandle,
    bookId: String,
) -> CommandResult<BookWorkspaceSummary> {
    let connection = open_database(&app)?;
    load_book_by_id(&connection, &bookId).map(|book| build_summary(&book))
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
        return Err("当前版本仅支持写入 SQLite 内置书库。".into());
    }

    with_transaction(&app, |transaction| {
        create_book_workspace_db(transaction, &bookName).map(|book| build_summary(&book))
    })
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

    with_transaction(&app, |transaction| {
        import_book_zip_db(transaction, &fileName, archiveBytes).map(|book| build_summary(&book))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_book_zip(app: AppHandle, rootPath: String) -> CommandResult<Option<String>> {
    let archive_bytes = {
        let connection = open_database(&app)?;
        export_book_zip_db(&connection, &rootPath)?
    };

    #[cfg(desktop)]
    {
        let connection = open_database(&app)?;
        let default_file_name = format!(
            "{}.zip",
            load_book_by_root_path(&connection, &rootPath)?.name
        );
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

        std::fs::write(&final_path, archive_bytes).map_err(error_to_string)?;
        Ok(Some(final_path.to_string_lossy().replace('\\', "/")))
    }

    #[cfg(mobile)]
    {
        let _ = app;
        let _ = archive_bytes;
        Err("当前平台暂不支持导出 ZIP 书籍包。".into())
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_book_workspace(app: AppHandle, rootPath: String) -> CommandResult<()> {
    with_transaction(&app, |transaction| {
        let book = load_book_by_root_path(transaction, &rootPath)?;
        delete_book_search_index(transaction, &book.id)?;
        transaction
            .execute(
                "DELETE FROM book_workspaces WHERE id = ?1",
                params![book.id],
            )
            .map_err(error_to_string)?;
        Ok(())
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn ensure_book_workspace_template(
    app: AppHandle,
    rootPath: String,
) -> CommandResult<Vec<String>> {
    with_transaction(&app, |transaction| {
        ensure_book_workspace_template_db(transaction, &rootPath)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_workspace_tree(
    app: AppHandle,
    rootPath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<TreeNode> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let connection = open_database(&app)?;
        read_workspace_tree_db(&connection, &rootPath)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file(
    app: AppHandle,
    rootPath: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let connection = open_database(&app)?;
        read_text_file_db(&connection, &rootPath, &path)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_text_file(
    app: AppHandle,
    rootPath: String,
    path: String,
    contents: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            write_text_file_db(transaction, &rootPath, &path, &contents)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn search_workspace_content(
    app: AppHandle,
    rootPath: String,
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
        let connection = open_database(&app)?;
        search_workspace_content_db(
            &connection,
            &rootPath,
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
pub fn read_text_file_line(
    app: AppHandle,
    rootPath: String,
    path: String,
    lineNumber: usize,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceLineResult> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let connection = open_database(&app)?;
        read_text_file_line_db(&connection, &rootPath, &path, lineNumber)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub fn replace_text_file_line(
    app: AppHandle,
    rootPath: String,
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
        with_transaction(&app, |transaction| {
            replace_text_file_line_db(
                transaction,
                &rootPath,
                &path,
                lineNumber,
                &contents,
                previousLine,
                nextLine,
            )
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_directory(
    app: AppHandle,
    rootPath: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            create_workspace_directory_db(transaction, &rootPath, &parentPath, &name)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_text_file(
    app: AppHandle,
    rootPath: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            create_workspace_text_file_db(transaction, &rootPath, &parentPath, &name)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn rename_workspace_entry(
    app: AppHandle,
    rootPath: String,
    path: String,
    nextName: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            rename_workspace_entry_db(transaction, &rootPath, &path, &nextName)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn move_workspace_entry(
    app: AppHandle,
    rootPath: String,
    path: String,
    targetParentPath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            move_workspace_entry_db(transaction, &rootPath, &path, &targetParentPath)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_workspace_entry(
    app: AppHandle,
    rootPath: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            delete_workspace_entry_db(transaction, &rootPath, &path)
        })
    })
}

// —— 文件关联(无向多对多)相关命令 ——

#[tauri::command]
#[allow(non_snake_case)]
pub fn list_entry_relations(
    app: AppHandle,
    rootPath: String,
    entryPath: String,
) -> CommandResult<Vec<RelationDto>> {
    let connection = open_database(&app)?;
    list_entry_relations_by_root(&connection, &rootPath, &entryPath)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn list_book_relations(
    app: AppHandle,
    rootPath: String,
) -> CommandResult<Vec<RelationDto>> {
    let connection = open_database(&app)?;
    list_book_relations_by_root(&connection, &rootPath)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_entry_relation(
    app: AppHandle,
    rootPath: String,
    entryAPath: String,
    entryBPath: String,
    relationship: String,
    note: Option<String>,
) -> CommandResult<RelationDto> {
    with_transaction(&app, |transaction| {
        create_relation_by_root(
            transaction,
            &rootPath,
            &entryAPath,
            &entryBPath,
            &relationship,
            note.as_deref(),
        )
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_entry_relation(
    app: AppHandle,
    rootPath: String,
    relationId: String,
    relationship: Option<String>,
    note: Option<String>,
    clearNote: Option<bool>,
) -> CommandResult<RelationDto> {
    // note 的三态语义通过两个字段表达,避免 serde 对 Option<Option<T>> 反序列化的歧义:
    //   两者皆缺省       → 不修改 note
    //   clearNote=true   → 清空 note(忽略 note 字段)
    //   note=Some(x)     → 改为 x
    let note_arg: Option<Option<&str>> = if clearNote.unwrap_or(false) {
        Some(None)
    } else {
        note.as_deref().map(Some)
    };

    with_transaction(&app, |transaction| {
        update_relation_by_root(
            transaction,
            &rootPath,
            &relationId,
            relationship.as_deref(),
            note_arg,
        )
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_entry_relation(
    app: AppHandle,
    rootPath: String,
    relationId: String,
) -> CommandResult<()> {
    with_transaction(&app, |transaction| {
        delete_relation_by_root(transaction, &rootPath, &relationId)
    })
}
