#![cfg(test)]

use crate::workspace::book::archive::{export_book_zip_db, import_book_zip_db};
use crate::workspace::book::data::{
    run_book_migrations, BookRecord,
};
use crate::workspace::book::ops::{
    delete_workspace_entry_db, move_workspace_entry_db, read_text_file_db,
    rename_workspace_entry_db, write_text_file_db,
};
use crate::workspace::book::templates::create_book_workspace_db;
use crate::workspace::book::tree::read_workspace_tree_db;
use rusqlite::Connection;

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
    assert!(project_agents.contains(".project/status/project-state.json"));
    assert!(project_agents.contains(".project/MEMORY/"));
    assert!(project_agents.contains("## 文件分工与回写要求"));
    assert!(project_agents.contains("03_规划/"));

    let project_readme = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/README.md",
    )
    .expect("project README should load");
    assert!(project_readme.contains("# 北境余烬 项目 README"));
    assert!(project_readme.contains("剧情梗概（100 字左右）"));
    assert!(project_readme.contains("## 写作风格"));
    assert!(project_readme.contains("主角目标"));
    assert!(project_readme.contains("章节规划.md"));

    let project_status = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/project-state.json",
    )
    .expect("project status should load");
    assert!(project_status.contains("\"bookName\": \"北境余烬\""));
    assert!(project_status.contains("\"projectMemory\": \".project/MEMORY\""));
    assert!(project_status.contains("\"projectStatus\": \".project/status\""));
    assert!(project_status.contains("\"planning\": \"03_规划\""));
    assert!(project_status.contains("\"projectReadme\": \".project/README.md\""));
    assert!(project_status.contains("\"latestPlot\": \".project/status/latest-plot.json\""));
    assert!(project_status.contains("\"characterState\": \".project/status/character-state.json\""));
    assert!(project_status.contains("\"plotSynopsis100\""));
    assert!(project_status.contains("\"protagonistGoal\""));
    assert!(project_status.contains("\"writingStyle\""));
    assert!(project_status.contains("\"chapterPlan\": \"03_规划/章节规划.md\""));
    assert!(project_status.contains("latest-plot.json"));
    assert!(project_status.contains("character-state.json"));

    let latest_plot = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/latest-plot.json",
    )
    .expect("latest plot should load");
    assert!(latest_plot.contains("\"bookName\": \"北境余烬\""));
    assert!(latest_plot.contains("\"activeConflicts\": []"));
    assert!(latest_plot.contains("\"openThreads\": []"));

    let character_state = read_text_file_db(
        &connection,
        &book.root_path,
        "books/北境余烬/.project/status/character-state.json",
    )
    .expect("character state should load");
    assert!(character_state.contains("\"bookName\": \"北境余烬\""));
    assert!(character_state.contains("\"characters\": {}"));

    let children = tree.children.expect("tree should contain children");
    let child_names = children
        .iter()
        .map(|child| child.name.clone())
        .collect::<Vec<_>>();
    let project_node = children
        .into_iter()
        .find(|child| child.name == ".project")
        .expect(".project should exist");
    let project_children = project_node
        .children
        .expect(".project should contain children");
    let project_child_names = project_children
        .iter()
        .map(|child| child.name.clone())
        .collect::<Vec<_>>();
    assert_eq!(project_child_names, vec!["MEMORY", "status", "AGENTS.md", "README.md"]);

    let status_child_names = project_children
        .into_iter()
        .find(|child| child.name == "status")
        .expect("status should exist")
        .children
        .expect("status should contain children")
        .into_iter()
        .map(|child| child.name)
        .collect::<Vec<_>>();
    assert_eq!(
        status_child_names,
        vec!["character-state.json", "latest-plot.json", "project-state.json"]
    );

    assert_eq!(child_names, vec![".project", "01_设定", "02_正文", "03_规划"]);
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
        "books/星河回声/02_正文",
    )
    .expect("file should move");
    assert_eq!(final_path, "books/星河回声/02_正文/序章.md");

    delete_workspace_entry_db(&transaction, &book.root_path, "books/星河回声/草稿")
        .expect("empty draft directory should delete");
    transaction.commit().expect("transaction should commit");

    let contents = read_text_file_db(&connection, &book.root_path, "books/星河回声/02_正文/序章.md")
        .expect("moved file should be readable");
    assert_eq!(contents, "第一行\n第二行");
}

#[test]
fn import_and_export_zip_roundtrip() {
    let mut source_connection = create_connection();
    let original = create_book(&mut source_connection, "北境余烬");
    let exported = export_book_zip_db(&source_connection, &original.root_path)
        .expect("zip should export");

    let mut target_connection = create_connection();
    let transaction = target_connection
        .transaction()
        .expect("transaction should open");
    let book = import_book_zip_db(&transaction, "北境余烬.zip", exported)
        .expect("zip should import");
    transaction.commit().expect("transaction should commit");

    let tree = read_workspace_tree_db(&target_connection, &book.root_path)
        .expect("tree should load");
    let child_names = tree
        .children
        .expect("tree should contain children")
        .into_iter()
        .map(|child| child.name)
        .collect::<Vec<_>>();
    assert_eq!(child_names, vec![".project", "01_设定", "02_正文", "03_规划"]);
}
