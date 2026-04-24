// 图书工作区：Tauri 命令入口。

use crate::db::open_database;
use crate::workspace::book::archive::{export_book_zip_db, import_book_zip_db};
use crate::workspace::book::data::{
    build_summary, list_books, load_book_by_id, load_book_by_root_path, BookWorkspaceSummary,
    TreeNode, WorkspaceLineResult, WorkspaceSearchMatch,
};
use crate::workspace::book::ops::{
    create_workspace_directory_db, create_workspace_text_file_db, delete_workspace_entry_db,
    move_workspace_entry_db, read_text_file_db, read_text_file_line_db, rename_workspace_entry_db,
    replace_text_file_line_db, write_text_file_db,
};
use crate::workspace::book::templates::create_book_workspace_db;
use crate::workspace::book::tree::{read_workspace_tree_db, search_workspace_content_db};
use crate::workspace::common::{
    check_cancellation, error_to_string, with_cancellable_request, CommandResult,
};
use crate::ToolCancellationRegistry;
use rusqlite::{params, Transaction};
use std::path::Path;
use tauri::{AppHandle, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

fn with_transaction<T, F>(app: &AppHandle, operation: F) -> CommandResult<T>
where
    F: FnOnce(&Transaction<'_>) -> CommandResult<T>,
{
    let mut connection = open_database(app)?;
    let transaction = connection.transaction().map_err(error_to_string)?;
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
        return Ok(app
            .dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().replace('\\', "/")));
    }

    #[cfg(mobile)]
    {
        let _ = app;
        Ok(None)
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
        return Ok(Some(final_path.to_string_lossy().replace('\\', "/")));
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
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<Vec<WorkspaceSearchMatch>> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        let connection = open_database(&app)?;
        search_workspace_content_db(
            &connection,
            &rootPath,
            &query,
            limit,
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
