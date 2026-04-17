use crate::db::open_database;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::{
    package_export::{
        build_export_archive, build_export_definition, build_export_manifest,
        build_export_package_id, sanitize_export_file_name,
    },
    repository::{list_steps, list_team_members, read_workflow},
    validate::{error_to_string, now_timestamp},
    CommandResult, WORKFLOW_SOURCE_INSTALLED,
};

pub(crate) fn delete_workflow(connection: &Connection, workflow_id: &str) -> CommandResult<()> {
    let workflow_record = connection
        .query_row(
            "SELECT source, package_id FROM workflows WHERE id = ?1",
            params![workflow_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(error_to_string)?;
    let Some((source, package_id)) = workflow_record else {
        return Err("未找到该工作流。".into());
    };

    connection
        .execute("DELETE FROM workflows WHERE id = ?1", params![workflow_id])
        .map_err(error_to_string)?;

    if source == "builtin" {
        if let Some(package_id) = package_id {
            connection
                .execute(
                    r#"
                    UPDATE workflow_packages
                    SET source_kind = ?2,
                        is_builtin = 0,
                        updated_at = ?3
                    WHERE id = ?1
                    "#,
                    params![
                        package_id,
                        WORKFLOW_SOURCE_INSTALLED,
                        now_timestamp() as i64
                    ],
                )
                .map_err(error_to_string)?;
        }
    }

    Ok(())
}

pub(crate) async fn export_workflow_zip(
    app: &AppHandle,
    workflow_id: &str,
) -> CommandResult<Option<String>> {
    let connection = open_database(app)?;
    let workflow = read_workflow(&connection, workflow_id)?;
    let members = list_team_members(&connection, workflow_id)?;
    let steps = list_steps(&connection, workflow_id)?;
    let package_id = build_export_package_id(&workflow);
    let manifest = build_export_manifest(&workflow, &package_id);
    let definition = build_export_definition(&workflow, &package_id, &members, &steps)?;
    let archive_bytes = build_export_archive(&manifest, &definition)?;

    #[cfg(desktop)]
    {
        let default_file_name = format!("{}.zip", sanitize_export_file_name(&workflow.name));
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

        let final_path = match save_path
            .extension()
            .and_then(|extension| extension.to_str())
        {
            Some(extension) if extension.eq_ignore_ascii_case("zip") => save_path,
            _ => save_path.with_extension("zip"),
        };

        std::fs::write(&final_path, archive_bytes).map_err(error_to_string)?;
        return Ok(Some(final_path.to_string_lossy().replace('\\', "/")));
    }

    #[cfg(mobile)]
    {
        let _ = app;
        let _ = archive_bytes;
        Err("当前平台暂不支持导出工作流 ZIP 包。".into())
    }
}
