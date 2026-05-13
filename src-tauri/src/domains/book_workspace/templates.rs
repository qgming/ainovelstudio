// 图书工作区：默认模板生成与新书创建逻辑。

use crate::domains::book_workspace::data::{
    build_book_root_path, ensure_directory_chain, insert_entry, BookRecord,
};
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

本文件定义本书的工作区约定。保持轻量，只放会影响日常创作和回写的规则。

## 事实源

- `.project/README.md`：作品定位、主线、人物概览、风格和当前重点。
- `.project/status/*.json`：剧情、人物、连续性和当前进度的结构化状态。
- `设定/`、`大纲/`、`正文/`：设定、大纲和正文内容。

## 读取原则

- 首次进入或初始化时只做轻量扫描：确认主要目录、README、status 和最近章节。
- 不要一开始完整展开全部文件夹或逐个读取所有文件。
- 续写、改写、审校、维护状态前，按任务相关性读取最小必要文件。
- 已由系统或用户上下文注入的文件视为已读，不重复读取。

## 目录约定

- `设定/`：人物、世界观、势力、道具、规则等设定资料。
- `大纲/`：全书大纲、卷纲、章纲、阶段方案。
- `正文/`：章节正文、番外、修订稿、终稿。
- `.project/status/`：程序和 AI 共同维护的轻量状态 JSON。

## 命名规则

1. 章节正文：`正文/第001章_章名.md`。
2. 章级细纲：`大纲/细纲_第001章.md`。
3. 设定文件按主题命名，例如 `设定/主角.md`、`设定/世界观.md`。
4. 同一类型文件保持一种编号和命名格式。

## Skill

长篇写作、拆文、润色、去 AI 味、工作流执行等任务，如果匹配已启用 skill，先读对应 `SKILL.md` 再执行。技能目录只用于定位，不当作完整方法论。

## 写回规则

- 创作成果写入 `正文/`，设定写入 `设定/`，规划写入 `大纲/`。
- 作品定位、主线、风格、当前重点写入 `.project/README.md`。
- 当前章节、活跃文件、最近剧情、人物状态、伏笔连续性写入 `.project/status/*.json`。
- 改已有文件优先局部修改；整文件覆盖只在新建或全量重写时使用。
- 完成时简短说明改了哪些文件、风险或下一步。
"#,
        book_name,
    )
}

pub(crate) fn create_project_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 项目 README

本文件记录这本书的核心 brief。保持短，后续有新事实再补。

## 作品定位

- 书名：`{BOOK_NAME}`
- 平台：待补充
- 类型：长篇 / 短篇待定
- 题材：待补充
- 目标读者：待补充
- 目标字数：待补充
- 核心卖点：待补充
- 一句话设定：待补充

## 故事总览

- 剧情梗概：待补充。用 80-120 字说明主角、目标、阻力和升级方向。
- 主角目标：待补充
- 核心冲突：待补充
- 结局方向：待补充

## 角色

- 主角：待补充
- 核心配角：待补充
- 主要对手：待补充

## 写作风格

- 叙事视角：待补充
- 语言风格：待补充
- 情绪基调：待补充
- 单章字数：默认 2500-3500 汉字
- 禁写约束：待补充

## 当前状态

- 当前阶段：构思中
- 当前进度：待补充
- 当前卷 / 当前章节：待补充
- 下一步：先补齐作品定位、剧情梗概、主角目标和大纲

## 建议补齐

- `设定/作品定位.md`
- `设定/主角.md`
- `设定/世界观.md`
- `大纲/大纲.md`
- `大纲/细纲_第001章.md`
- `正文/第001章_章名.md`
"#,
        book_name,
    )
}

pub(crate) fn create_project_status_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "projectStage": "构思中",
  "workspaceVersion": 4,
  "primaryLanguage": "zh-CN",
  "targetWordCount": null,
  "currentWordCount": 0,
  "storyProfile": {
    "platform": "待补充",
    "genre": "待补充",
    "targetAudience": "待补充",
    "coreSellingPoint": "待补充",
    "premise": "待补充",
    "plotSynopsis": "待补充"
  },
  "writingStyle": {
    "narrativePerspective": "待补充",
    "languageStyle": "待补充",
    "emotionalTone": "待补充",
    "chapterWordCountMin": 2500,
    "chapterWordCountMax": 3500,
    "taboos": []
  },
  "directories": {
    "setting": "设定",
    "outline": "大纲",
    "draft": "正文",
    "projectMeta": ".project",
    "projectStatus": ".project/status"
  },
  "defaultFiles": {
    "guide": ".project/AGENTS.md",
    "projectReadme": ".project/README.md",
    "contextManifest": ".project/context-manifest.json",
    "projectState": ".project/status/project-state.json",
    "systemState": ".project/status/system-state.json",
    "latestPlot": ".project/status/latest-plot.json",
    "characterState": ".project/status/character-state.json",
    "continuityIndex": ".project/status/continuity-index.json"
  },
  "recommendedFiles": {
    "projectReadme": ".project/README.md",
    "projectPositioning": "设定/作品定位.md",
    "protagonist": "设定/主角.md",
    "worldbuilding": "设定/世界观.md",
    "outline": "大纲/大纲.md",
    "chapterPlan": "大纲/细纲_第001章.md",
    "firstChapter": "正文/第001章_章名.md"
  },
  "namingRules": {
    "chapterDraft": "正文/第001章_章名.md",
    "chapterOutline": "大纲/细纲_第001章.md"
  },
  "aiInstructions": [
    "初始化或首次进入时只做轻量目录扫描，不完整展开全部文件。",
    "任务明显匹配已启用 skill 时，先读取对应 SKILL.md。",
    "改已有文件优先局部修改；整文件覆盖只在新建或全量重写时使用。",
    "推进剧情后同步更新 latest-plot.json，必要时更新 continuity-index.json。",
    "角色状态变化后同步更新 character-state.json。",
    "当前章节、活跃文件或阶段变化后同步更新 system-state.json。"
  ],
  "status": {
    "currentFocus": "待明确题材、剧情梗概、主角目标、写作风格与大纲",
    "nextAction": "先补齐 .project/README.md，再建立大纲和第001章细纲",
    "currentArc": null,
    "lastUpdated": null
  }
}
"#,
        book_name,
    )
}

pub(crate) fn create_system_state_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "currentPhase": "构思中",
  "currentTask": "待补充",
  "currentVolume": null,
  "currentOutlineFile": null,
  "currentChapterFile": null,
  "lastCompletedChapter": null,
  "lastPlannedChapter": null,
  "activeFiles": [],
  "pendingReviews": [],
  "lastSyncAt": null,
  "updatedAt": null
}
"#,
        book_name,
    )
}

pub(crate) fn create_latest_plot_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "currentArc": null,
  "currentVolume": null,
  "currentChapter": null,
  "currentScene": null,
  "latestUpdate": null,
  "recentChapters": [],
  "timelineUpdates": [],
  "activeConflicts": [],
  "openThreads": [],
  "nextExpectedPush": null,
  "updatedAt": null
}
"#,
        book_name,
    )
}

pub(crate) fn create_character_state_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "characters": {},
  "updates": [],
  "updatedAt": null
}
"#,
        book_name,
    )
}

pub(crate) fn create_continuity_index_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "openThreads": [],
  "foreshadowing": [],
  "resolvedThreads": [],
  "continuityRisks": [],
  "refs": [],
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
  "version": 2,
  "policies": [
    {
      "taskType": "book",
      "alwaysInclude": [
        ".project/AGENTS.md",
        ".project/README.md",
        ".project/status/project-state.json",
        ".project/status/system-state.json"
      ],
      "includeIfActive": [],
      "summaryFirst": [],
      "fullReadTriggers": [
        "立项",
        "题材",
        "平台",
        "卖点"
      ],
      "charBudget": 18000,
      "priority": 10
    },
    {
      "taskType": "chapter-write",
      "alwaysInclude": [
        ".project/AGENTS.md",
        ".project/README.md",
        ".project/status/system-state.json",
        ".project/status/latest-plot.json",
        ".project/status/character-state.json",
        ".project/status/continuity-index.json"
      ],
      "includeIfActive": [
        "大纲/大纲.md"
      ],
      "summaryFirst": [],
      "fullReadTriggers": [
        "续写",
        "正文",
        "下一章",
        "连续性"
      ],
      "charBudget": 26000,
      "priority": 30
    },
    {
      "taskType": "continuity-review",
      "alwaysInclude": [
        ".project/status/latest-plot.json",
        ".project/status/character-state.json",
        ".project/status/continuity-index.json"
      ],
      "includeIfActive": [],
      "summaryFirst": [],
      "fullReadTriggers": [
        "审校",
        "连续性",
        "伏笔",
        "战力"
      ],
      "charBudget": 22000,
      "priority": 20
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
                ".project/status/system-state.json",
                create_system_state_template(book_name),
            ),
            (
                ".project/status/latest-plot.json",
                create_latest_plot_template(book_name),
            ),
            (
                ".project/status/character-state.json",
                create_character_state_template(book_name),
            ),
            (
                ".project/status/continuity-index.json",
                create_continuity_index_template(book_name),
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

    Ok(book)
}
