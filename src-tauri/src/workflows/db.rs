use rusqlite::Connection;

use super::{validate::error_to_string, CommandResult};

const WORKFLOW_SCHEMA_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS workflow_packages (
        id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        manifest_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        base_prompt TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        source TEXT NOT NULL DEFAULT 'user',
        template_key TEXT,
        package_id TEXT,
        workspace_binding_json TEXT,
        loop_config_json TEXT NOT NULL,
        team_member_ids_json TEXT NOT NULL DEFAULT '[]',
        step_ids_json TEXT NOT NULL DEFAULT '[]',
        last_run_id TEXT,
        last_run_status TEXT NOT NULL DEFAULT 'idle',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_team_members (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role_label TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        order_index INTEGER NOT NULL,
        responsibility_prompt TEXT NOT NULL DEFAULT '',
        allowed_tool_ids_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        workspace_binding_json TEXT NOT NULL,
        loop_config_snapshot_json TEXT NOT NULL,
        current_loop_index INTEGER NOT NULL,
        max_loops INTEGER,
        current_step_run_id TEXT,
        stop_reason TEXT,
        summary TEXT,
        error_message TEXT,
        FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_step_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        loop_index INTEGER NOT NULL,
        attempt_index INTEGER NOT NULL,
        member_id TEXT,
        status TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        input_prompt TEXT NOT NULL,
        result_text TEXT NOT NULL,
        result_json TEXT,
        message_type TEXT,
        message_json TEXT,
        decision_json TEXT,
        parts_json TEXT NOT NULL DEFAULT '[]',
        usage_json TEXT,
        error_message TEXT,
        FOREIGN KEY(run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
        FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_packages_id
    ON workflow_packages(id);

    CREATE INDEX IF NOT EXISTS idx_workflow_packages_updated_at
    ON workflow_packages(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_workflows_package_id
    ON workflows(package_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_template_key
    ON workflows(template_key)
    WHERE template_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_workflows_updated_at
    ON workflows(updated_at DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_workflow_team_members_workflow_order
    ON workflow_team_members(workflow_id, order_index ASC);

    CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_order
    ON workflow_steps(workflow_id, order_index ASC);

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started_at
    ON workflow_runs(workflow_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_run_loop_attempt
    ON workflow_step_runs(run_id, loop_index ASC, attempt_index ASC, started_at ASC);
"#;

pub(crate) fn run_workflow_migrations(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(WORKFLOW_SCHEMA_SQL)
        .map_err(error_to_string)?;
    rebuild_legacy_run_tables(connection)?;
    ensure_column(
        connection,
        "workflows",
        "base_prompt",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(connection, "workflow_step_runs", "message_type", "TEXT")?;
    ensure_column(connection, "workflow_step_runs", "message_json", "TEXT")?;
    rebuild_development_workflow_run_tables(connection)?;
    Ok(())
}

fn rebuild_development_workflow_run_tables(connection: &Connection) -> CommandResult<()> {
    let has_legacy_tables = table_exists(connection, "workflow_runs_legacy")?
        || table_exists(connection, "workflow_step_runs_legacy")?;
    let has_obsolete_run_tables = table_exists(connection, "workflow_node_runs")?
        || table_exists(connection, "workflow_run_events")?;
    let has_legacy_run_references = schema_references_table(connection, "workflow_runs_legacy")?
        || schema_references_table(connection, "workflow_step_runs_legacy")?;
    let max_loops_requires_value = workflow_runs_max_loops_is_required(connection)?;

    if !has_legacy_tables
        && !has_obsolete_run_tables
        && !has_legacy_run_references
        && !max_loops_requires_value
    {
        return Ok(());
    }

    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = OFF;
            DROP TABLE IF EXISTS workflow_run_events;
            DROP TABLE IF EXISTS workflow_node_runs;
            DROP TABLE IF EXISTS workflow_step_runs;
            DROP TABLE IF EXISTS workflow_runs;
            DROP TABLE IF EXISTS workflow_step_runs_legacy;
            DROP TABLE IF EXISTS workflow_runs_legacy;
            PRAGMA foreign_keys = ON;
            "#,
        )
        .map_err(error_to_string)?;

    connection
        .execute_batch(WORKFLOW_SCHEMA_SQL)
        .map_err(error_to_string)?;

    Ok(())
}

fn workflow_runs_max_loops_is_required(connection: &Connection) -> CommandResult<bool> {
    let pragma = "PRAGMA table_info(workflow_runs)";
    let mut statement = connection.prepare(pragma).map_err(error_to_string)?;
    let columns = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?))
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(columns
        .iter()
        .find(|(name, _)| name == "max_loops")
        .map(|(_, notnull)| *notnull == 1)
        .unwrap_or(false))
}

fn rebuild_legacy_run_tables(connection: &Connection) -> CommandResult<()> {
    if table_has_column(connection, "workflow_runs", "workspace_binding_json")? {
        return Ok(());
    }

    connection
        .execute_batch(
            r#"
            DROP TABLE IF EXISTS workflow_step_runs;
            DROP TABLE IF EXISTS workflow_runs;
            "#,
        )
        .map_err(error_to_string)?;
    connection
        .execute_batch(WORKFLOW_SCHEMA_SQL)
        .map_err(error_to_string)?;
    Ok(())
}

fn table_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> CommandResult<bool> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection.prepare(&pragma).map_err(error_to_string)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    Ok(columns.iter().any(|column| column == column_name))
}

fn table_exists(connection: &Connection, table_name: &str) -> CommandResult<bool> {
    let mut statement = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")
        .map_err(error_to_string)?;
    let exists = statement
        .query_row([table_name], |_row| Ok(()))
        .map(|_| true)
        .or_else(|error| {
            if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
                Ok(false)
            } else {
                Err(error_to_string(error))
            }
        })?;
    Ok(exists)
}

fn schema_references_table(connection: &Connection, table_name: &str) -> CommandResult<bool> {
    let pattern = format!("%{table_name}%");
    let mut statement = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE sql IS NOT NULL AND sql LIKE ?1 LIMIT 1")
        .map_err(error_to_string)?;
    let exists = statement
        .query_row([pattern], |_row| Ok(()))
        .map(|_| true)
        .or_else(|error| {
            if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
                Ok(false)
            } else {
                Err(error_to_string(error))
            }
        })?;
    Ok(exists)
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> CommandResult<()> {
    if table_has_column(connection, table_name, column_name)? {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
            [],
        )
        .map_err(error_to_string)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{run_workflow_migrations, schema_references_table, table_exists, table_has_column};
    use rusqlite::Connection;

    #[test]
    fn workflow_migrations_rebuild_tables_that_still_reference_legacy_run_tables() {
        let connection = Connection::open_in_memory().expect("in-memory db should open");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE workflows (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    base_prompt TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'draft',
                    source TEXT NOT NULL DEFAULT 'user',
                    template_key TEXT,
                    package_id TEXT,
                    workspace_binding_json TEXT,
                    loop_config_json TEXT NOT NULL,
                    team_member_ids_json TEXT NOT NULL DEFAULT '[]',
                    step_ids_json TEXT NOT NULL DEFAULT '[]',
                    last_run_id TEXT,
                    last_run_status TEXT NOT NULL DEFAULT 'idle',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE workflow_runs (
                    id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at INTEGER NOT NULL,
                    finished_at INTEGER,
                    workspace_binding_json TEXT NOT NULL,
                    loop_config_snapshot_json TEXT NOT NULL,
                    current_loop_index INTEGER NOT NULL,
                    max_loops INTEGER,
                    current_step_run_id TEXT,
                    stop_reason TEXT,
                    summary TEXT,
                    error_message TEXT,
                    FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
                );

                CREATE TABLE workflow_step_runs (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    workflow_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    loop_index INTEGER NOT NULL,
                    attempt_index INTEGER NOT NULL,
                    member_id TEXT,
                    status TEXT NOT NULL,
                    started_at INTEGER,
                    finished_at INTEGER,
                    input_prompt TEXT NOT NULL,
                    result_text TEXT NOT NULL,
                    result_json TEXT,
                    decision_json TEXT,
                    parts_json TEXT NOT NULL DEFAULT '[]',
                    usage_json TEXT,
                    error_message TEXT,
                    FOREIGN KEY(run_id) REFERENCES "workflow_runs_legacy"(id) ON DELETE CASCADE,
                    FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
                );

                CREATE TABLE workflow_node_runs (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    node_type TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'idle',
                    input_snapshot_json TEXT NOT NULL DEFAULT '{}',
                    output_snapshot_json TEXT NOT NULL DEFAULT '{}',
                    error_message TEXT,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    FOREIGN KEY(run_id) REFERENCES "workflow_runs_legacy"(id) ON DELETE CASCADE
                );

                CREATE TABLE workflow_run_events (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    node_run_id TEXT,
                    kind TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES "workflow_runs_legacy"(id) ON DELETE CASCADE,
                    FOREIGN KEY(node_run_id) REFERENCES workflow_node_runs(id) ON DELETE CASCADE
                );
                "#,
            )
            .expect("legacy workflow schema should build");

        run_workflow_migrations(&connection)
            .expect("workflow migrations should rebuild legacy schema");

        assert!(
            !schema_references_table(&connection, "workflow_runs_legacy")
                .expect("schema reference lookup should succeed")
        );
        assert!(
            !table_exists(&connection, "workflow_node_runs").expect("table lookup should succeed")
        );
        assert!(
            !table_exists(&connection, "workflow_run_events").expect("table lookup should succeed")
        );
        assert!(
            table_has_column(&connection, "workflow_step_runs", "message_type")
                .expect("column lookup should succeed")
        );
        assert!(
            table_has_column(&connection, "workflow_step_runs", "message_json")
                .expect("column lookup should succeed")
        );
    }
}
