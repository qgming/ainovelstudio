use crate::app::ToolCancellationRegistry;
use crate::domains::book_workspace::archive::{export_book_zip_db, import_book_zip_db};
use crate::domains::book_workspace::data::{run_book_migrations, BookRecord};
use crate::domains::book_workspace::maintenance::ensure_book_workspace_template_db;
use crate::domains::book_workspace::ops::{
    delete_workspace_entry_db, move_workspace_entry_db, read_text_file_db,
    rename_workspace_entry_db, write_text_file_db,
};
use crate::domains::book_workspace::search::search_workspace_content_db;
use crate::domains::book_workspace::templates::create_book_workspace_db;
use crate::domains::book_workspace::tree::read_workspace_tree_db;
use rusqlite::Connection;
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

fn create_connection() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory db should open");
    run_book_migrations(&connection).expect("workspace tables should migrate");
    connection
}

fn create_book(connection: &mut Connection, name: &str) -> BookRecord {
    let transaction = connection.transaction().expect("transaction should open");
    let book = create_book_workspace_db(&transaction, name).expect("book should be created");
    transaction.commit().expect("transaction should commit");
    book
}

fn read_root_child_names(connection: &Connection, root_path: &str) -> Vec<String> {
    read_workspace_tree_db(connection, root_path)
        .expect("tree should load")
        .children
        .expect("tree should contain children")
        .into_iter()
        .map(|child| child.name)
        .collect()
}

#[test]
fn create_book_workspace_db_builds_template_tree() {
    let mut connection = create_connection();
    let book = create_book(&mut connection, "北境余烬");
    let tree = read_workspace_tree_db(&connection, &book.root_path).expect("tree should load");

    assert_eq!(tree.name, "北境余烬");
    assert_eq!(tree.path, "books/北境余烬");
    let project_agents = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/AGENTS.md",
    )
    .expect("project AGENTS should load");
    assert!(project_agents.contains("# 北境余烬 工作区 AGENTS"));
    assert!(project_agents.contains(".project/README.md"));
    assert!(project_agents.contains(".project/status/*.json"));
    assert!(project_agents.contains("轻量扫描"));
    assert!(project_agents.contains("不要一开始完整展开全部文件夹"));
    assert!(project_agents.contains("## Skill"));
    assert!(project_agents.contains("SKILL.md"));
    assert!(project_agents.contains("## 命名规则"));
    assert!(project_agents.contains("正文/第001章_章名.md"));
    assert!(project_agents.contains("大纲/细纲_第001章.md"));
    assert!(project_agents.contains("设定/世界观.md"));

    let project_readme = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/README.md",
    )
    .expect("project README should load");
    assert!(project_readme.contains("# 北境余烬 项目 README"));
    assert!(project_readme.contains("剧情梗概"));
    assert!(project_readme.contains("## 写作风格"));
    assert!(project_readme.contains("主角目标"));
    assert!(project_readme.contains("大纲/细纲_第001章.md"));
    assert!(project_readme.contains("正文/第001章_章名.md"));

    let context_manifest = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/context-manifest.json",
    )
    .expect("context manifest should load");
    assert!(context_manifest.contains("\"version\": 2"));
    assert!(context_manifest.contains("\"taskType\": \"book\""));
    assert!(context_manifest.contains("\"taskType\": \"chapter-write\""));
    assert!(!context_manifest.contains(".project/style/voice.md"));
    assert!(!context_manifest.contains(".project/canon/README.md"));

    let project_status = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/project-state.json",
    )
    .expect("project status should load");
    assert!(project_status.contains("\"bookName\": \"北境余烬\""));
    assert!(project_status.contains("\"workspaceVersion\": 4"));
    assert!(project_status.contains("\"projectStatus\": \".project/status\""));
    assert!(project_status.contains("\"outline\": \"大纲\""));
    assert!(project_status.contains("\"draft\": \"正文\""));
    assert!(project_status.contains("\"worldbuilding\": \"设定/世界观.md\""));
    assert!(project_status.contains("\"systemState\": \".project/status/system-state.json\""));
    assert!(project_status.contains("\"contextManifest\": \".project/context-manifest.json\""));
    assert!(
        project_status.contains("\"continuityIndex\": \".project/status/continuity-index.json\"")
    );
    assert!(project_status.contains("\"chapterDraft\": \"正文/第001章_章名.md\""));
    assert!(project_status.contains("\"chapterPlan\": \"大纲/细纲_第001章.md\""));
    assert!(project_status.contains("\"firstChapter\": \"正文/第001章_章名.md\""));
    assert!(project_status.contains("任务明显匹配已启用 skill"));

    let system_state = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/system-state.json",
    )
    .expect("system state should load");
    assert!(system_state.contains("\"bookName\": \"北境余烬\""));
    assert!(system_state.contains("\"currentPhase\": \"构思中\""));
    assert!(system_state.contains("\"activeFiles\": []"));

    let latest_plot = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/latest-plot.json",
    )
    .expect("latest plot should load");
    assert!(latest_plot.contains("\"bookName\": \"北境余烬\""));
    assert!(latest_plot.contains("\"activeConflicts\": []"));
    assert!(latest_plot.contains("\"openThreads\": []"));
    assert!(latest_plot.contains("\"recentChapters\": []"));
    assert!(latest_plot.contains("\"timelineUpdates\": []"));

    let character_state = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/character-state.json",
    )
    .expect("character state should load");
    assert!(character_state.contains("\"bookName\": \"北境余烬\""));
    assert!(character_state.contains("\"characters\": {}"));
    assert!(character_state.contains("\"updates\": []"));

    let continuity_index = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/continuity-index.json",
    )
    .expect("continuity index should load");
    assert!(continuity_index.contains("\"bookName\": \"北境余烬\""));
    assert!(continuity_index.contains("\"foreshadowing\": []"));
    assert!(continuity_index.contains("\"continuityRisks\": []"));
    assert!(continuity_index.contains("\"refs\": []"));

    let children = tree.children.expect("tree should contain children");
    let child_names = children
        .iter()
        .map(|child| child.name.clone())
        .collect::<Vec<_>>();
    let project_node = children
        .iter()
        .find(|child| child.name == ".project")
        .expect(".project should exist");
    let project_children = project_node
        .children
        .clone()
        .expect(".project should contain children");
    let project_child_names = project_children
        .iter()
        .map(|child| child.name.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        project_child_names,
        vec!["status", "AGENTS.md", "context-manifest.json", "README.md"]
    );

    let status_child_names = project_children
        .iter()
        .find(|child| child.name == "status")
        .expect("status should exist")
        .children
        .clone()
        .expect("status should contain children")
        .into_iter()
        .map(|child| child.name)
        .collect::<Vec<_>>();
    assert_eq!(
        status_child_names,
        vec![
            "character-state.json",
            "continuity-index.json",
            "latest-plot.json",
            "project-state.json",
            "system-state.json"
        ]
    );

    assert_eq!(child_names, vec![".project", "大纲", "正文", "设定"]);
}

#[test]
fn workspace_operations_use_sqlite_storage() {
    let mut connection = create_connection();
    let book = create_book(&mut connection, "星河回声");
    let transaction = connection.transaction().expect("transaction should open");

    write_text_file_db(
        &transaction,
        &book.root_path,
        "books/星河回声/草稿/第001章.md",
        "第一行\n第二行",
    )
    .expect("file should be written");
    let moved_path = rename_workspace_entry_db(
        &transaction,
        &book.root_path,
        "books/星河回声/草稿/第001章.md",
        "序章.md",
    )
    .expect("file should rename");
    assert_eq!(moved_path, "books/星河回声/草稿/序章.md");

    let final_path = move_workspace_entry_db(
        &transaction,
        &book.root_path,
        "books/星河回声/草稿/序章.md",
        "books/星河回声/正文",
    )
    .expect("file should move");
    assert_eq!(final_path, "books/星河回声/正文/序章.md");

    delete_workspace_entry_db(&transaction, &book.root_path, "books/星河回声/草稿")
        .expect("empty draft directory should delete");
    transaction.commit().expect("transaction should commit");

    let contents = read_text_file_db(&connection, &book.root_path, "books/星河回声/正文/序章.md")
        .expect("moved file should be readable");
    assert_eq!(contents, "第一行\n第二行");
}

#[test]
fn workspace_search_returns_agent_context_chunks() {
    let mut connection = create_connection();
    let book = create_book(&mut connection, "黑钟纪事");
    let transaction = connection.transaction().expect("transaction should open");
    write_text_file_db(
        &transaction,
        &book.root_path,
        "books/黑钟纪事/设定/人物.md",
        "# 沈砚\n沈砚是黑钟持有者。\n他在雪夜第一次听见钟声。",
    )
    .expect("file should be written");
    transaction.commit().expect("transaction should commit");

    let registry = ToolCancellationRegistry::default();
    let result = search_workspace_content_db(
        &connection,
        &book.root_path,
        "沈砚 黑钟",
        Some(5),
        Some("character"),
        Some(vec!["设定".into()]),
        Some(2_000),
        Some(true),
        &registry,
        None,
    )
    .expect("search should return context");

    assert_eq!(result.query, "沈砚 黑钟");
    assert_eq!(result.intent, "character");
    assert!(!result.results.is_empty());
    let hit = &result.results[0];
    assert_eq!(hit.path, "设定/人物.md");
    assert_eq!(hit.source_kind, "character");
    assert!(hit.preview.contains("沈砚是黑钟持有者"));
    assert!(hit.matched_terms.iter().any(|term| term == "沈砚"));
    assert!(!result.suggested_reads.is_empty());
}

#[test]
fn ensure_book_workspace_template_restores_missing_defaults_only() {
    let mut connection = create_connection();
    let book = create_book(&mut connection, "旧书升级");
    let transaction = connection.transaction().expect("transaction should open");

    write_text_file_db(
        &transaction,
        &book.root_path,
        "books/旧书升级/.project/AGENTS.md",
        "# 自定义规则\n保留用户内容",
    )
    .expect("custom AGENTS should write");
    delete_workspace_entry_db(
        &transaction,
        &book.root_path,
        "books/旧书升级/.project/context-manifest.json",
    )
    .expect("manifest should delete");
    delete_workspace_entry_db(
        &transaction,
        &book.root_path,
        "books/旧书升级/.project/status",
    )
    .expect("status directory should delete");

    let created_paths = ensure_book_workspace_template_db(&transaction, &book.root_path)
        .expect("template should repair");
    transaction.commit().expect("transaction should commit");

    assert!(created_paths.contains(&".project/context-manifest.json".to_string()));
    assert!(created_paths.contains(&".project/status".to_string()));
    assert!(created_paths.contains(&".project/status/project-state.json".to_string()));
    assert!(created_paths.contains(&".project/status/latest-plot.json".to_string()));

    let project_agents = read_text_file_db(
        &connection,
        &book.root_path,
        "books/旧书升级/.project/AGENTS.md",
    )
    .expect("project AGENTS should remain readable");
    assert_eq!(project_agents, "# 自定义规则\n保留用户内容");

    let context_manifest = read_text_file_db(
        &connection,
        &book.root_path,
        "books/旧书升级/.project/context-manifest.json",
    )
    .expect("manifest should be restored");
    assert!(context_manifest.contains("\"taskType\": \"book\""));

    let latest_plot = read_text_file_db(
        &connection,
        &book.root_path,
        "books/旧书升级/.project/status/latest-plot.json",
    )
    .expect("latest plot should be restored");
    assert!(latest_plot.contains("\"bookName\": \"旧书升级\""));
}

#[test]
fn import_and_export_zip_roundtrip() {
    let mut source_connection = create_connection();
    let original = create_book(&mut source_connection, "北境余烬");
    let exported =
        export_book_zip_db(&source_connection, &original.root_path).expect("zip should export");

    let mut target_connection = create_connection();
    let transaction = target_connection
        .transaction()
        .expect("transaction should open");
    let book =
        import_book_zip_db(&transaction, "北境余烬.zip", exported).expect("zip should import");
    transaction.commit().expect("transaction should commit");

    assert_eq!(
        read_root_child_names(&target_connection, &book.root_path),
        vec![".project", "大纲", "正文", "设定"]
    );
}

#[test]
fn import_plain_zip_without_project_agents() {
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    archive
        .start_file("章节/第001章.md", options)
        .expect("zip file should start");
    archive
        .write_all("第一章正文".as_bytes())
        .expect("zip file should write");
    let archive_bytes = archive.finish().expect("zip should finish").into_inner();

    let mut connection = create_connection();
    let transaction = connection.transaction().expect("transaction should open");
    let book = import_book_zip_db(&transaction, "普通资料.zip", archive_bytes)
        .expect("plain zip should import");
    transaction.commit().expect("transaction should commit");

    let project_agents = read_text_file_db(
        &connection,
        &book.root_path,
        "books/普通资料/.project/AGENTS.md",
    )
    .expect("project AGENTS should be supplemented");
    assert!(project_agents.contains("# 普通资料 工作区 AGENTS"));
    assert_eq!(
        read_root_child_names(&connection, &book.root_path),
        vec![".project", "章节"]
    );
}
