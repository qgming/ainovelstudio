use crate::app::ToolCancellationRegistry;
use crate::domains::book_workspace::archive::{export_book_zip_db, import_book_zip_db};
use crate::domains::book_workspace::data::BookRecord;
use crate::domains::book_workspace::fs_store::WorkspaceStore;
use crate::domains::book_workspace::maintenance::ensure_book_workspace_template_db;
use crate::domains::book_workspace::ops::{
    create_workspace_text_file_db, delete_workspace_entry_db, edit_text_file_db,
    move_workspace_entry_db, read_text_file_db, rename_workspace_entry_db, write_text_file_db,
};
use crate::domains::book_workspace::relations::{
    create_relation_by_root, delete_relation_by_root, list_book_relations_by_root,
    list_entry_relations_by_root, update_relation_by_root,
};
use crate::domains::book_workspace::search::search_workspace_content_db;
use crate::domains::book_workspace::templates::create_book_workspace_db;
use crate::domains::book_workspace::tree::read_workspace_tree_db;
use std::io::{Cursor, Write};
use tempfile::TempDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

/// 测试用存储：把 books_root 指向一个临时目录，TempDir 句柄随结构存活以避免提前清理。
struct TestStore {
    store: WorkspaceStore,
    _dir: TempDir,
}

fn create_store() -> TestStore {
    let dir = TempDir::new().expect("temp dir should be created");
    let store = WorkspaceStore::new(dir.path().join("books"));
    TestStore { store, _dir: dir }
}

fn create_book(store: &WorkspaceStore, name: &str) -> BookRecord {
    create_book_workspace_db(store, name).expect("book should be created")
}

fn read_root_child_names(store: &WorkspaceStore, book_id: &str) -> Vec<String> {
    read_workspace_tree_db(store, book_id)
        .expect("tree should load")
        .children
        .expect("tree should contain children")
        .into_iter()
        .map(|child| child.name)
        .collect()
}

#[test]
fn create_book_workspace_db_builds_template_tree() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "北境余烬");
    let tree = read_workspace_tree_db(&store, &book.id).expect("tree should load");

    assert_eq!(tree.name, "北境余烬");
    assert_eq!(tree.path, "books/北境余烬");

    let project_agents = read_text_file_db(&store, &book.id, "books/北境余烬/.project/AGENTS.md")
        .expect("project AGENTS should load");
    assert!(project_agents.contains("# 北境余烬 工作区 AGENTS"));
    assert!(project_agents.contains(".project/README.md"));
    assert!(project_agents.contains("## 命名规则"));
    assert!(project_agents.contains("正文/第001章_章名.md"));
    assert!(project_agents.contains("大纲/细纲_第001章.md"));
    assert!(project_agents.contains("设定/世界观.md"));

    let project_readme = read_text_file_db(&store, &book.id, "books/北境余烬/.project/README.md")
        .expect("project README should load");
    assert!(project_readme.contains("# 北境余烬 项目 README"));
    assert!(project_readme.contains("剧情梗概"));
    assert!(project_readme.contains("## 写作风格"));
    assert!(project_readme.contains("主角目标"));

    let context_manifest = read_text_file_db(
        &store,
        &book.id,
        "books/北境余烬/.project/context-manifest.json",
    )
    .expect("context manifest should load");
    assert!(context_manifest.contains("\"taskType\": \"book\""));
    assert!(context_manifest.contains("\"taskType\": \"chapter-write\""));

    let project_status = read_text_file_db(
        &store,
        &book.id,
        "books/北境余烬/.project/status/project-state.json",
    )
    .expect("project status should load");
    assert!(project_status.contains("\"bookName\": \"北境余烬\""));

    let story_state = read_text_file_db(
        &store,
        &book.id,
        "books/北境余烬/.project/status/story-state.json",
    )
    .expect("story state should load");
    assert!(story_state.contains("\"bookName\": \"北境余烬\""));

    let children = tree.children.expect("tree should contain children");
    let child_names = children
        .iter()
        .map(|child| child.name.clone())
        .collect::<Vec<_>>();
    assert_eq!(child_names, vec![".project", "大纲", "正文", "设定"]);

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
        vec!["project-state.json", "story-state.json"]
    );
}

#[test]
fn workspace_operations_use_real_file_storage() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "星河回声");

    write_text_file_db(
        &store,
        &book.id,
        "books/星河回声/草稿/第001章.md",
        "第一行\n第二行",
    )
    .expect("file should be written");
    let moved_path = rename_workspace_entry_db(
        &store,
        &book.id,
        "books/星河回声/草稿/第001章.md",
        "序章.md",
    )
    .expect("file should rename");
    assert_eq!(moved_path, "books/星河回声/草稿/序章.md");

    let final_path = move_workspace_entry_db(
        &store,
        &book.id,
        "books/星河回声/草稿/序章.md",
        "books/星河回声/正文",
    )
    .expect("file should move");
    assert_eq!(final_path, "books/星河回声/正文/序章.md");

    delete_workspace_entry_db(&store, &book.id, "books/星河回声/草稿")
        .expect("empty draft directory should delete");

    let contents = read_text_file_db(&store, &book.id, "books/星河回声/正文/序章.md")
        .expect("moved file should be readable");
    assert_eq!(contents, "第一行\n第二行");
}

#[test]
fn edit_text_file_replaces_unique_occurrence() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "编辑之书");
    write_text_file_db(
        &store,
        &book.id,
        "books/编辑之书/正文/第001章.md",
        "沈砚走进雪夜。\n他听见钟声。",
    )
    .expect("file should be written");

    edit_text_file_db(
        &store,
        &book.id,
        "books/编辑之书/正文/第001章.md",
        "他听见钟声。",
        "他听见了遥远的钟声。",
    )
    .expect("edit should succeed");

    let contents = read_text_file_db(&store, &book.id, "books/编辑之书/正文/第001章.md")
        .expect("file should read");
    assert_eq!(contents, "沈砚走进雪夜。\n他听见了遥远的钟声。");
}

#[test]
fn edit_text_file_rejects_non_unique_match() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "歧义之书");
    write_text_file_db(
        &store,
        &book.id,
        "books/歧义之书/正文/第001章.md",
        "钟声\n钟声",
    )
    .expect("file should be written");

    let result = edit_text_file_db(
        &store,
        &book.id,
        "books/歧义之书/正文/第001章.md",
        "钟声",
        "回声",
    );
    assert!(result.is_err(), "non-unique match should be rejected");
}

#[test]
fn workspace_search_returns_agent_context_chunks() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "黑钟纪事");
    write_text_file_db(
        &store,
        &book.id,
        "books/黑钟纪事/设定/人物.md",
        "# 沈砚\n沈砚是黑钟持有者。\n他在雪夜第一次听见钟声。",
    )
    .expect("file should be written");

    let registry = ToolCancellationRegistry::default();
    let result = search_workspace_content_db(
        &store,
        &book.id,
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

/// 子树增量重建：rename/move/delete 后，搜索索引只跟随被操作的子树变化。
/// 验证 rename 后旧路径不再命中、新路径正确命中；delete 后彻底搜不到。
#[test]
fn workspace_search_follows_subtree_rename_and_delete() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "索引随动");
    write_text_file_db(
        &store,
        &book.id,
        "books/索引随动/设定/人物.md",
        "# 沈砚\n沈砚是黑钟持有者，独行雪夜。",
    )
    .expect("file should be written");

    let registry = ToolCancellationRegistry::default();
    let search = |query: &str| {
        search_workspace_content_db(
            &store,
            &book.id,
            query,
            Some(8),
            None,
            None,
            Some(2_000),
            Some(true),
            &registry,
            None,
        )
        .expect("search should succeed")
    };

    // rename：旧文件名命中消失，新文件名命中出现，正文仍可检索到新路径。
    let renamed =
        rename_workspace_entry_db(&store, &book.id, "books/索引随动/设定/人物.md", "主角档案")
            .expect("rename should succeed");
    assert_eq!(renamed, "books/索引随动/设定/主角档案.md");

    let by_old_name = search("人物");
    assert!(
        by_old_name
            .results
            .iter()
            .all(|hit| hit.path != "设定/人物.md"),
        "旧路径不应再被索引命中"
    );
    let by_content = search("沈砚 黑钟");
    assert!(
        by_content
            .results
            .iter()
            .any(|hit| hit.path == "设定/主角档案.md"),
        "新路径应被索引命中"
    );

    // delete：删除后正文彻底搜不到。
    delete_workspace_entry_db(&store, &book.id, "books/索引随动/设定/主角档案.md")
        .expect("delete should succeed");
    let after_delete = search("沈砚 黑钟");
    assert!(
        after_delete
            .results
            .iter()
            .all(|hit| hit.path != "设定/主角档案.md"),
        "删除后不应再有索引命中"
    );
}

#[test]
fn ensure_book_workspace_template_restores_missing_defaults_only() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "旧书升级");

    write_text_file_db(
        &store,
        &book.id,
        "books/旧书升级/.project/AGENTS.md",
        "# 自定义规则\n保留用户内容",
    )
    .expect("custom AGENTS should write");
    delete_workspace_entry_db(
        &store,
        &book.id,
        "books/旧书升级/.project/context-manifest.json",
    )
    .expect("manifest should delete");
    delete_workspace_entry_db(&store, &book.id, "books/旧书升级/.project/status")
        .expect("status directory should delete");

    let created_paths =
        ensure_book_workspace_template_db(&store, &book.id).expect("template should repair");

    assert!(created_paths.contains(&".project/context-manifest.json".to_string()));
    assert!(created_paths.contains(&".project/status".to_string()));
    assert!(created_paths.contains(&".project/status/project-state.json".to_string()));
    assert!(created_paths.contains(&".project/status/story-state.json".to_string()));

    let project_agents = read_text_file_db(&store, &book.id, "books/旧书升级/.project/AGENTS.md")
        .expect("project AGENTS should remain readable");
    assert_eq!(project_agents, "# 自定义规则\n保留用户内容");

    let context_manifest = read_text_file_db(
        &store,
        &book.id,
        "books/旧书升级/.project/context-manifest.json",
    )
    .expect("manifest should be restored");
    assert!(context_manifest.contains("\"taskType\": \"book\""));
}

#[test]
fn import_and_export_zip_roundtrip() {
    let source = create_store();
    let original = create_book(&source.store, "北境余烬");
    let exported = export_book_zip_db(&source.store, &original.id).expect("zip should export");

    let target = create_store();
    let book =
        import_book_zip_db(&target.store, "北境余烬.zip", exported).expect("zip should import");

    assert_eq!(
        read_root_child_names(&target.store, &book.id),
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

    let TestStore { store, _dir } = create_store();
    let book =
        import_book_zip_db(&store, "普通资料.zip", archive_bytes).expect("plain zip should import");

    let project_agents = read_text_file_db(&store, &book.id, "books/普通资料/.project/AGENTS.md")
        .expect("project AGENTS should be supplemented");
    assert!(project_agents.contains("# 普通资料 工作区 AGENTS"));
    assert_eq!(
        read_root_child_names(&store, &book.id),
        vec![".project", "章节"]
    );
}

// —— 文件关联 ——

fn seed_two_files(store: &WorkspaceStore, book: &BookRecord) -> (String, String) {
    let path_a = create_workspace_text_file_db(store, &book.id, &book.root_path, "细纲.md")
        .expect("file a should be created");
    let path_b = create_workspace_text_file_db(store, &book.id, &book.root_path, "林夕.md")
        .expect("file b should be created");
    (path_a, path_b)
}

#[test]
fn relations_create_list_and_delete_roundtrip() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "试炼之书");
    let (path_a, path_b) = seed_two_files(&store, &book);

    let relation = create_relation_by_root(
        &store,
        &book.id,
        &path_a,
        &path_b,
        "出场人物",
        Some("本章主角"),
    )
    .expect("relation should be created");

    assert_eq!(relation.relationship, "出场人物");
    assert_eq!(relation.note.as_deref(), Some("本章主角"));
    assert!(relation.entry_a_path <= relation.entry_b_path);

    let from_a = list_entry_relations_by_root(&store, &book.id, &path_a)
        .expect("list from a should succeed");
    let from_b = list_entry_relations_by_root(&store, &book.id, &path_b)
        .expect("list from b should succeed");
    assert_eq!(from_a.len(), 1);
    assert_eq!(from_b.len(), 1);
    assert_eq!(from_a[0].id, relation.id);

    let all = list_book_relations_by_root(&store, &book.id).expect("list all should succeed");
    assert_eq!(all.len(), 1);

    let duplicate = create_relation_by_root(&store, &book.id, &path_a, &path_b, "出场人物", None);
    assert!(duplicate.is_err(), "duplicate relation should be rejected");

    create_relation_by_root(&store, &book.id, &path_a, &path_b, "引用设定", None)
        .expect("second label should be allowed");
    let after_second =
        list_entry_relations_by_root(&store, &book.id, &path_a).expect("list should succeed");
    assert_eq!(after_second.len(), 2);

    delete_relation_by_root(&store, &book.id, &relation.id).expect("delete should succeed");
    let remaining =
        list_entry_relations_by_root(&store, &book.id, &path_a).expect("list should succeed");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].relationship, "引用设定");
}

#[test]
fn relations_cannot_self_link() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "自指之书");
    let (path_a, _) = seed_two_files(&store, &book);

    let result = create_relation_by_root(&store, &book.id, &path_a, &path_a, "自我", None);
    assert!(result.is_err(), "self relation should be rejected");
}

#[test]
fn relations_update_changes_label_and_note() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "改名之书");
    let (path_a, path_b) = seed_two_files(&store, &book);

    let relation_id =
        create_relation_by_root(&store, &book.id, &path_a, &path_b, "旧标签", Some("旧备注"))
            .expect("relation should be created")
            .id;

    let updated = update_relation_by_root(&store, &book.id, &relation_id, Some("新标签"), None)
        .expect("update should succeed");
    assert_eq!(updated.relationship, "新标签");
    assert_eq!(updated.note.as_deref(), Some("旧备注"));

    let cleared = update_relation_by_root(&store, &book.id, &relation_id, None, Some(None))
        .expect("update should succeed");
    assert_eq!(cleared.note, None);
}

#[test]
fn relations_follow_rename_of_entry() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "重命名之书");
    let (path_a, path_b) = seed_two_files(&store, &book);

    create_relation_by_root(&store, &book.id, &path_a, &path_b, "出场", None)
        .expect("relation should be created");

    let renamed_path = rename_workspace_entry_db(&store, &book.id, &path_a, "新名")
        .expect("rename should succeed");

    let relations =
        list_entry_relations_by_root(&store, &book.id, &renamed_path).expect("list should succeed");
    assert_eq!(relations.len(), 1);

    let old_relations =
        list_entry_relations_by_root(&store, &book.id, &path_a).expect("list should succeed");
    assert_eq!(old_relations.len(), 0);
}

#[test]
fn relations_removed_when_entry_deleted() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "删除之书");
    let (path_a, path_b) = seed_two_files(&store, &book);

    create_relation_by_root(&store, &book.id, &path_a, &path_b, "出场", None)
        .expect("relation should be created");

    delete_workspace_entry_db(&store, &book.id, &path_a).expect("delete should succeed");

    let remaining =
        list_entry_relations_by_root(&store, &book.id, &path_b).expect("list should succeed");
    assert_eq!(remaining.len(), 0);
}

#[test]
fn relations_follow_move_into_subdirectory() {
    let TestStore { store, _dir } = create_store();
    let book = create_book(&store, "迁移之书");

    let (path_a, path_b) = seed_two_files(&store, &book);
    let target_dir = format!("{}/设定", book.root_path);

    create_relation_by_root(&store, &book.id, &path_a, &path_b, "出场", None)
        .expect("relation should be created");

    let moved_a = move_workspace_entry_db(&store, &book.id, &path_a, &target_dir)
        .expect("move should succeed");

    let relations =
        list_entry_relations_by_root(&store, &book.id, &moved_a).expect("list should succeed");
    assert_eq!(relations.len(), 1);
}
