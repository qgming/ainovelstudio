use crate::infrastructure::db::open_database;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

type CommandResult<T> = Result<T, String>;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardSnapshotEntry {
    books: Vec<Value>,
    category_id: i64,
    gender: i64,
    #[serde(rename = "type")]
    rank_type: i64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardSnapshotPayload {
    date: String,
    entries: Vec<LeaderboardSnapshotEntry>,
    version: String,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

#[tauri::command]
pub fn read_leaderboard_snapshot(
    app: AppHandle,
    date: String,
    version: String,
) -> CommandResult<Option<LeaderboardSnapshotPayload>> {
    let connection = open_database(&app)?;
    let snapshot_version = connection
        .query_row(
            "SELECT version FROM leaderboard_snapshots WHERE date = ?1 AND version = ?2",
            params![date, version],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;

    if snapshot_version.is_none() {
        return Ok(None);
    }

    let mut statement = connection
        .prepare(
            r#"
            SELECT gender, rank_type, category_id, books_json
            FROM leaderboard_snapshot_entries
            WHERE snapshot_date = ?1 AND version = ?2
            ORDER BY gender DESC, rank_type DESC, category_id ASC
            "#,
        )
        .map_err(error_to_string)?;

    let entries = statement
        .query_map(params![date, version], |row| {
            let books_json: String = row.get(3)?;
            let books = serde_json::from_str::<Vec<Value>>(&books_json).unwrap_or_default();
            Ok(LeaderboardSnapshotEntry {
                books,
                category_id: row.get(2)?,
                gender: row.get(0)?,
                rank_type: row.get(1)?,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(Some(LeaderboardSnapshotPayload {
        date,
        entries,
        version,
    }))
}

#[tauri::command]
pub fn write_leaderboard_snapshot(
    app: AppHandle,
    snapshot: LeaderboardSnapshotPayload,
) -> CommandResult<()> {
    let mut connection = open_database(&app)?;
    let transaction = connection.transaction().map_err(error_to_string)?;
    let date = snapshot.date;
    let version = snapshot.version;

    transaction
        .execute(
            r#"
            INSERT INTO leaderboard_snapshots (date, version, updated_at)
            VALUES (?1, ?2, strftime('%s', 'now'))
            ON CONFLICT(date) DO UPDATE
            SET version = excluded.version,
                updated_at = excluded.updated_at
            "#,
            params![date, version],
        )
        .map_err(error_to_string)?;

    transaction
        .execute(
            "DELETE FROM leaderboard_snapshot_entries WHERE snapshot_date = ?1",
            params![date],
        )
        .map_err(error_to_string)?;

    for entry in snapshot.entries {
        let books_json = serde_json::to_string(&entry.books).map_err(error_to_string)?;
        transaction
            .execute(
                r#"
                INSERT INTO leaderboard_snapshot_entries (
                    snapshot_date, version, gender, rank_type, category_id, books_json, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s', 'now'))
                "#,
                params![
                    date,
                    version,
                    entry.gender,
                    entry.rank_type,
                    entry.category_id,
                    books_json,
                ],
            )
            .map_err(error_to_string)?;
    }

    transaction.commit().map_err(error_to_string)?;
    Ok(())
}
