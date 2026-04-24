// 图书工作区：默认模板生成与新书创建逻辑。

use crate::workspace::book::data::{
    build_book_root_path, ensure_directory_chain, insert_entry, BookRecord,
};
use crate::workspace::common::{
    error_to_string, file_extension, now_timestamp, parent_relative_path, validate_name,
    CommandResult,
};
use rusqlite::{params, OptionalExtension, Transaction};
use uuid::Uuid;

pub(crate) fn create_project_agents_template(book_name: &str) -> String {
    format!(
        "# {book_name} 项目说明\n\n你正在处理一本网络小说项目工作区。对话与工作流会默认加载本文件，用它快速理解这本书的定位、剧情主线、写作风格、目录分工和协作约束。\n\n## 作品定位\n- 书名：`{book_name}`\n- 平台：待补充\n- 写作模式：长篇 / 短篇待定\n- 题材大类：待补充\n- 细分题材：待补充\n- 目标读者：待补充\n- 目标字数：待补充\n- 核心卖点：待补充\n- 一句话 premise：待补充\n\n## 故事总览\n- 剧情梗概（100 字左右）：待补充。用 80-120 字概括整本书主线，至少说明主角是谁、主角想达成什么目标、主要阻力是什么、故事会往哪个方向升级。\n- 主角目标：待补充\n- 核心冲突：待补充\n- 长线悬念：待补充\n- 结局方向：待补充\n\n## 写作风格\n- 叙事视角：待补充\n- 叙事语气：待补充\n- 节奏要求：待补充\n- 语言风格：待补充\n- 情绪基调：待补充\n- 平台适配重点：待补充\n- 禁写约束：待补充\n\n## 当前推进重点\n- 当前阶段：构思中\n- 当前进度：待补充\n- 当前卷 / 当前剧情位置：待补充\n- 下一步最重要动作：先补齐题材定位、剧情梗概和写作风格\n- 当前缺口：待补充\n\n## 工作区结构\n- `.project/AGENTS.md`：项目级 AI 协作入口说明；对话和工作流会默认加载本文件。\n- `.project/status/project-state.json`：当前项目状态、目录用途、写作约束与协作约定。\n- `.project/MEMORY/`：项目长期记忆目录；用于沉淀专题记忆、阶段记录、检查清单与后续持续补充的项目资料。\n- `01_设定/`：人物设定、世界观、题材规则、故事方案。\n- `02_正文/`：章节正文、番外、修订稿、最终稿。\n- `03_规划/`：参考资料、章节规划、大纲规划、命名备忘和阶段性方案。\n\n## 建议优先补齐的项目文件\n- `01_设定/作品定位.md`：平台、题材、卖点、受众、篇幅方向。\n- `01_设定/剧情梗概.md`：全书主线、主角目标、主要冲突、阶段升级。\n- `01_设定/写作风格.md`：视角、语气、节奏、语言习惯、禁写项。\n- `01_设定/人物设定.md`：主角、重要配角、关系与动机。\n- `03_规划/章节规划.md`：当前卷的章节拆分、节奏安排和每章目标。\n\n## AI 协作通用说明\n1. 开始任务前，优先遵循 `.project/AGENTS.md` 与 `.project/status/project-state.json`。\n2. `.project/MEMORY/` 下如有相关记忆文件，按任务需要主动读取并利用。\n3. 先读真实文件，再写正文、设定、梗概、规划或审稿意见。\n4. 新建内容时优先复用现有目录，不主动扩展无关目录层级。\n5. 设定类内容写入 `01_设定/`，正文类内容写入 `02_正文/`，规划、参考资料和提纲类内容写入 `03_规划/`。\n6. 生成正文时严格参考本文件中的剧情梗概、主角目标和写作风格；这些信息缺失时，优先补齐再推进长篇续写。\n7. 修改故事方向、篇幅、风格、阶段进度后，同步更新 `.project/status/project-state.json`。\n8. 临时分析、批注、提纲应优先落盘到工作区文件，避免只停留在对话里。\n\n## 默认写作约束\n- 保持目录简洁，优先在现有结构内推进。\n- 文件命名保持稳定、可检索、可批量处理。\n- 设定、正文、规划分区明确，避免混放。\n- 剧情推进优先围绕主角目标、核心冲突和阶段 payoff 展开。\n- 风格漂移、人物动机漂移、设定漂移发生后，要优先回写项目资料再继续创作。\n"
    )
}

pub(crate) fn create_project_status_template(book_name: &str) -> String {
    format!(
        "{{\n  \"bookName\": \"{book_name}\",\n  \"projectStage\": \"构思中\",\n  \"workspaceVersion\": 1,\n  \"primaryLanguage\": \"zh-CN\",\n  \"targetWordCount\": null,\n  \"currentWordCount\": 0,\n  \"writingMode\": \"长篇/短篇待定\",\n  \"storyProfile\": {{\n    \"platform\": \"待补充\",\n    \"genre\": \"待补充\",\n    \"subGenre\": \"待补充\",\n    \"targetAudience\": \"待补充\",\n    \"coreSellingPoint\": \"待补充\",\n    \"premise\": \"待补充\",\n    \"plotSynopsis100\": \"待补充：用 80-120 字概括整本书主线、主角目标、主要阻力和升级方向。\",\n    \"protagonistGoal\": \"待补充\",\n    \"coreConflict\": \"待补充\",\n    \"longlineSuspense\": \"待补充\",\n    \"endingDirection\": \"待补充\"\n  }},\n  \"writingStyle\": {{\n    \"narrativePerspective\": \"待补充\",\n    \"tone\": \"待补充\",\n    \"pace\": \"待补充\",\n    \"languageStyle\": \"待补充\",\n    \"emotionalTone\": \"待补充\",\n    \"platformAdaptation\": \"待补充\",\n    \"taboos\": [\n      \"待补充\"\n    ]\n  }},\n  \"directories\": {{\n    \"setting\": \"01_设定\",\n    \"draft\": \"02_正文\",\n    \"planning\": \"03_规划\",\n    \"projectMeta\": \".project\",\n    \"projectMemory\": \".project/MEMORY\",\n    \"projectStatus\": \".project/status\"\n  }},\n  \"defaultFiles\": {{\n    \"guide\": \".project/AGENTS.md\",\n    \"projectState\": \".project/status/project-state.json\",\n    \"latestPlot\": \".project/status/latest-plot.json\",\n    \"characterState\": \".project/status/character-state.json\"\n  }},\n  \"recommendedFiles\": {{\n    \"projectPositioning\": \"01_设定/作品定位.md\",\n    \"plotSynopsis\": \"01_设定/剧情梗概.md\",\n    \"writingStyle\": \"01_设定/写作风格.md\",\n    \"characterBible\": \"01_设定/人物设定.md\",\n    \"chapterPlan\": \"03_规划/章节规划.md\"\n  }},\n  \"aiInstructions\": [\n    \"开始任务前先读取 .project/AGENTS.md、.project/status/project-state.json、.project/status/latest-plot.json 和 .project/status/character-state.json。\",\n    \"如 .project/MEMORY 下存在相关资料，按任务需要主动读取。\",\n    \"设定写入 01_设定，正文写入 02_正文，规划、参考资料和提纲写入 03_规划。\",\n    \"不要擅自重命名顶层目录。\",\n    \"新增章节时优先使用清晰且稳定的文件名。\",\n    \"剧情梗概、主角目标和写作风格缺失时，优先补齐再推进长篇续写。\",\n    \"项目阶段、字数目标、结构调整、风格调整后要同步回写本文件。\",\n    \"剧情推进后同步更新 latest-plot.json，人物即时状态变化后同步更新 character-state.json。\"\n  ],\n  \"status\": {{\n    \"currentFocus\": \"待明确题材、剧情梗概、主角目标与写作风格\",\n    \"nextAction\": \"在 01_设定 中补齐作品定位、剧情梗概和写作风格，并在 03_规划 中建立章节规划\",\n    \"currentArc\": null,\n    \"lastUpdated\": null\n  }}\n}}\n"
    )
}

pub(crate) fn create_latest_plot_template(book_name: &str) -> String {
    format!(
        "{{\n  \"bookName\": \"{book_name}\",\n  \"currentArc\": null,\n  \"currentVolume\": null,\n  \"currentChapter\": null,\n  \"currentScene\": null,\n  \"latestUpdate\": null,\n  \"activeConflicts\": [],\n  \"openThreads\": [],\n  \"nextExpectedPush\": null,\n  \"updatedAt\": null\n}}\n"
    )
}

pub(crate) fn create_character_state_template(book_name: &str) -> String {
    format!(
        "{{\n  \"bookName\": \"{book_name}\",\n  \"characters\": {{}},\n  \"updatedAt\": null\n}}\n"
    )
}

pub(crate) fn build_book_template(
    book_name: &str,
) -> (Vec<&'static str>, Vec<(&'static str, String)>) {
    (
        vec![
            ".project",
            ".project/MEMORY",
            ".project/status",
            "01_设定",
            "02_正文",
            "03_规划",
        ],
        vec![
            (
                ".project/AGENTS.md",
                create_project_agents_template(book_name),
            ),
            (
                ".project/status/project-state.json",
                create_project_status_template(book_name),
            ),
            (
                ".project/status/latest-plot.json",
                create_latest_plot_template(book_name),
            ),
            (
                ".project/status/character-state.json",
                create_character_state_template(book_name),
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
