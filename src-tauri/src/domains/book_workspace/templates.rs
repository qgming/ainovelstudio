// 图书工作区：默认模板生成与新书创建逻辑。

use crate::domains::book_workspace::data::{
    build_book_root_path, ensure_directory_chain, insert_entry, BookRecord,
};
use crate::domains::book_workspace::search::rebuild_book_search_index;
use crate::infrastructure::workspace_paths::{
    error_to_string, file_extension, now_timestamp, parent_relative_path, validate_name,
    CommandResult,
};
use rusqlite::{params, OptionalExtension, Transaction};
use uuid::Uuid;

fn render_book_template(template: &str, book_name: &str) -> String {
    template.replace("{BOOK_NAME}", book_name)
}

pub(crate) fn create_project_agents_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 工作区 AGENTS

本文件定义本书的项目级约定。通用主代理人设、读取原则、写回规则与 Skill 用法由全局 AGENTS 提供,本文件只补充本书特有的约定。

## 协作目标

你和作者共享这个图书工作区。你的任务不是只给建议,而是把作者当前目标推进成可用成果:作品 brief、大纲、细纲、正文、设定、状态更新或审稿结论。

能直接完成的任务就直接完成;需要选择题材、视角、主线、风格等关键方向时再问。问之前先看本书已有资料,避免让作者重复交代。

## 事实源(本书特定路径)

- `.project/README.md`:作品定位、读者承诺、主线、人物概览、风格和当前重点。
- `.project/status/*.json`:剧情、人物、连续性、当前进度和协作状态的结构化状态。
- `设定/`、`大纲/`、`正文/`:设定、大纲和正文内容。

资料冲突时:已经写入的正文事实优先;其次是 status 和设定;再其次是 README 与旧对话。作者最新明确要求优先于旧资料。

## 目录约定

- `设定/`:人物、世界观、势力、道具、规则等设定资料。
- `大纲/`:全书大纲、卷纲、章纲、阶段方案。
- `正文/`:章节正文、番外、修订稿、终稿。
- `.project/status/`:程序和 AI 共同维护的轻量状态 JSON。

## 命名规则

1. 章节正文:`正文/第001章_章名.md`。
2. 章级细纲:`大纲/细纲_第001章.md`。
3. 设定文件按主题命名,例如 `设定/主角.md`、`设定/世界观.md`。
4. 同一类型文件保持一种编号和命名格式。

## 创作判断

- 本书的既有文风优先。改文前先判断原文想要达成的情绪和节奏。
- 大纲必须能指导写作:每个关键节点要有行动、阻力、反转和结果。
- 设定必须能落到人物选择、场景动作和剧情后果上。
- 审稿要指出真实问题:哪里拖、哪里空、哪里不可信、哪里爽点不足、哪里文风跑偏。
- 不确定的事实不要编成设定。需要推断时明确说这是推断。
"#,
        book_name,
    )
}

pub(crate) fn create_project_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 项目 README

本文件是这本书的创作 brief。保持短，但要足够指导 AI 和作者继续推进。新事实一旦确定，优先补这里或 status。

## 作品定位

- 书名：`{BOOK_NAME}`
- 平台：待补充
- 类型：长篇 / 短篇待定
- 题材：待补充
- 目标读者：待补充
- 目标字数：待补充
- 一句话设定：待补充
- 核心卖点：待补充
- 读者承诺：待补充。读者点开这本书，预期持续获得什么爽感、情绪或新鲜感。
- 开篇承诺：待补充。前 3 章要让读者相信什么、期待什么。

## 故事总览

- 剧情梗概：待补充。用 80-120 字说明主角、目标、阻力、升级方向和阶段回报。
- 主角目标：待补充。要能转化成具体行动。
- 核心冲突：待补充
- 升级路径：待补充
- 主要反转：待补充
- 结局方向：待补充

## 角色

- 主角：待补充。包含欲望、短板、底线、能力边界和开局处境。
- 核心配角：待补充。写清和主角的关系、功能与变化。
- 主要对手：待补充。写清压迫力、资源、目标和失败代价。
- 关键关系：待补充

## 写作风格

- 叙事视角：待补充
- 语言风格：待补充
- 情绪基调：待补充
- 单章字数：默认 2500-3500 汉字
- 禁写约束：待补充
- 节奏偏好：待补充。例：快节奏打脸、慢热悬疑、强情绪拉扯。
- 对话口味：待补充。例：短句、有来有回、口语感强。

## 当前状态

- 当前阶段：构思中
- 当前进度：待补充
- 当前卷 / 当前章节：待补充
- 当前目标：待补充
- 阻塞点：待补充
- 下一步：先补齐作品定位、剧情梗概、主角目标、读者承诺和大纲

## 首轮建议补齐

- `设定/作品定位.md`
- `设定/主角.md`
- `设定/世界观.md`
- `大纲/大纲.md`
- `大纲/细纲_第001章.md`
- `正文/第001章_章名.md`

## 状态维护约定

- 当前阶段、当前章节、活跃文件、阻塞项变化后更新 `.project/status/project-state.json`。
- 剧情推进、人物变化、伏笔与连续性变化后更新 `.project/status/story-state.json`。
"#,
        book_name,
    )
}

pub(crate) fn create_project_status_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "projectStage": "构思中",
  "currentPhase": "构思中",
  "currentObjective": "完成作品 brief 和开篇方向",
  "currentVolume": null,
  "currentChapterFile": null,
  "lastCompletedChapter": null,
  "activeFiles": [],
  "blockers": [
    "题材未定",
    "读者承诺未定",
    "主角目标未定"
  ],
  "nextAction": "先补齐 .project/README.md，再建立大纲和第001章细纲",
  "updatedAt": null
}
"#,
        book_name,
    )
}

pub(crate) fn create_story_state_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "plot": {
    "currentArc": null,
    "currentVolume": null,
    "currentChapter": null,
    "currentScene": null,
    "recentChapters": [],
    "activeConflicts": [],
    "openThreads": [],
    "sceneQueue": [],
    "unresolvedQuestions": [],
    "nextExpectedPush": null
  },
  "characters": {},
  "relationships": [],
  "continuity": {
    "canonFacts": [],
    "timelineAnchors": [],
    "foreshadowing": [],
    "resolvedThreads": [],
    "risks": []
  },
  "updatedAt": null
}
"#,
        book_name,
    )
}

pub(crate) fn create_context_manifest_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "version": 3,
  "policies": [
    {
      "taskType": "book",
      "alwaysInclude": [
        ".project/AGENTS.md",
        ".project/README.md",
        ".project/status/project-state.json"
      ],
      "includeIfActive": [],
      "priority": 10
    },
    {
      "taskType": "chapter-write",
      "alwaysInclude": [
        ".project/AGENTS.md",
        ".project/README.md",
        ".project/status/project-state.json",
        ".project/status/story-state.json"
      ],
      "includeIfActive": [
        "大纲/大纲.md"
      ],
      "priority": 30
    }
  ]
}
"#,
        book_name,
    )
}

pub(crate) fn build_book_template(
    book_name: &str,
) -> (Vec<&'static str>, Vec<(&'static str, String)>) {
    (
        vec![".project", ".project/status", "设定", "大纲", "正文"],
        vec![
            (
                ".project/AGENTS.md",
                create_project_agents_template(book_name),
            ),
            (
                ".project/README.md",
                create_project_readme_template(book_name),
            ),
            (
                ".project/context-manifest.json",
                create_context_manifest_template(book_name),
            ),
            (
                ".project/status/project-state.json",
                create_project_status_template(book_name),
            ),
            (
                ".project/status/story-state.json",
                create_story_state_template(book_name),
            ),
        ],
    )
}

pub(crate) fn create_book_workspace_db(
    transaction: &Transaction<'_>,
    book_name: &str,
) -> CommandResult<BookRecord> {
    let validated_name = validate_name(book_name)?;
    let root_path = build_book_root_path(&validated_name);
    let existing = transaction
        .query_row(
            "SELECT id FROM book_workspaces WHERE name = ?1 OR root_path = ?2",
            params![validated_name, root_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;
    if existing.is_some() {
        return Err("同名书籍已存在。".into());
    }

    let timestamp = now_timestamp();
    let book = BookRecord {
        id: Uuid::new_v4().to_string(),
        name: validated_name.clone(),
        root_path,
        updated_at: timestamp,
    };
    transaction
        .execute(
            r#"
            INSERT INTO book_workspaces (id, name, root_path, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                book.id,
                book.name,
                book.root_path,
                timestamp as i64,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;

    let (directories, files) = build_book_template(&validated_name);
    for directory in directories {
        insert_entry(
            transaction,
            &book.id,
            directory,
            "directory",
            None,
            &[],
            timestamp,
        )?;
    }
    for (relative_path, contents) in files {
        ensure_directory_chain(
            transaction,
            &book.id,
            &parent_relative_path(relative_path),
            timestamp,
        )?;
        insert_entry(
            transaction,
            &book.id,
            relative_path,
            "file",
            file_extension(relative_path).as_deref(),
            contents.as_bytes(),
            timestamp,
        )?;
    }

    rebuild_book_search_index(transaction, &book.id)?;
    Ok(book)
}
