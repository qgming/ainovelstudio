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
        "# {book_name} 工作区 AGENTS\n\n你正在处理一本网络小说项目工作区。对话和工作流会默认加载本文件，用它理解工作区结构、操作规则、工具使用方式和回写要求。作品本身的定位、剧情、人物、风格与推进状态，统一写在 `.project/README.md`。\n\n## 建议起手读取顺序\n1. `.project/AGENTS.md`：理解工作区结构、工具约定、文件分工和回写规则。\n2. `.project/README.md`：理解这本书的定位、剧情主线、人物关系、风格与当前推进重点。\n3. `.project/status/project-state.json`：核对结构化状态、目录约定和真值层字段。\n4. `.project/MEMORY/`：按任务需要读取长期记忆、阶段记录、检查清单和专题资料。\n5. 相关正文、设定、规划文件：再进入具体创作、修改、审稿或同步。\n\n## 工作区结构\n- `.project/AGENTS.md`：工作区说明、工具使用规则、文件分工、写作与回写要求。\n- `.project/README.md`：书籍说明与项目总览；记录作品定位、剧情主线、风格、阶段进度和当前重点。\n- `.project/status/project-state.json`：项目结构化状态真值层；记录目录用途、默认文件、写作约束和阶段状态。\n- `.project/status/latest-plot.json`：最近剧情推进、当前冲突、悬而未决线索和下一步预期。\n- `.project/status/character-state.json`：角色即时状态、资源、关系和最新变化。\n- `.project/MEMORY/`：可持续更新的长期记忆目录；适合沉淀阶段结论、专题摘要、连续性索引、返修清单与稳定经验。\n- `01_设定/`：人物设定、世界观、题材规则、力量体系、故事方案。\n- `02_正文/`：章节正文、番外、修订稿、最终稿。\n- `03_规划/`：参考资料、章节规划、大纲规划、命名备忘和阶段方案。\n\n## 工具与操作约定\n1. 涉及工作区内容时，先读真实文件，再写正文、设定、规划、审稿意见或状态文件。\n2. 不确定路径时优先看目录和状态文件，再定位目标文件。\n3. 修改已有内容时优先做局部更新；仅在确实需要整体重写时再整文件覆盖。\n4. 写结构化状态时，优先保持字段稳定、命名稳定和目录稳定，方便后续自动化读取。\n5. 新建内容时优先复用现有目录，不主动扩展无关目录层级。\n\n## 文件分工与回写要求\n1. 作品介绍、题材定位、剧情总览、人物概览、风格、当前阶段重点，写入 `.project/README.md`。\n2. 结构化项目状态、目录约定、默认文件、阶段信息，写入 `.project/status/project-state.json`。\n3. 最新剧情推进写入 `.project/status/latest-plot.json`；人物即时变化写入 `.project/status/character-state.json`。\n4. 可复用的专题记忆、阶段结论、连续性索引、返修记录和长期检查清单，写入 `.project/MEMORY/` 对应文件。\n5. 设定类内容写入 `01_设定/`，正文类内容写入 `02_正文/`，规划、参考资料和提纲写入 `03_规划/`。\n6. 临时分析、批注、提纲和审稿结论优先落盘到工作区文件，避免只停留在对话里。\n7. 当作品定位、剧情方向、人物关系、风格基线或阶段目标发生变化时，主动同步更新 `.project/README.md`，必要时连带更新状态文件和 MEMORY。\n\n## 技能与记忆使用建议\n- 进入陌生项目、冷启动项目或缺资料项目时，优先先补 `.project/README.md`，再补设定与规划。\n- 遇到连续性、状态同步、人物追踪或长期伏笔问题时，优先读取并更新 `.project/MEMORY/` 和 `status/` 真值层。\n- 需要专门方法时，主动调用对应 skill；技能规则服务于当前项目文件，不替代项目真值层。\n\n## 默认写作要求\n- 生成正文前，先核对 `.project/README.md`、相关设定、最近正文和状态文件，确保方向一致。\n- 保持目录简洁，文件命名稳定、可检索、可批量处理。\n- 设定、正文、规划分区明确，避免混放。\n- 剧情推进优先围绕主角目标、核心冲突和阶段 payoff 展开。\n- 风格漂移、人物动机漂移、设定漂移发生后，先回写 README、状态文件或 MEMORY，再继续创作。\n"
    )
}

pub(crate) fn create_project_readme_template(book_name: &str) -> String {
    format!(
        "# {book_name} 项目 README\n\n本文件用于记录这本书本身的信息。对话和工作流会默认加载本文件，用它快速理解作品定位、剧情主线、风格、人物关系和当前推进重点。工作区规则、工具约定和回写要求，统一查看 `.project/AGENTS.md`。\n\n## 作品定位\n- 书名：`{book_name}`\n- 平台：待补充\n- 写作模式：长篇 / 短篇待定\n- 题材大类：待补充\n- 细分题材：待补充\n- 目标读者：待补充\n- 目标字数：待补充\n- 核心卖点：待补充\n- 一句话 premise：待补充\n\n## 故事总览\n- 剧情梗概（100 字左右）：待补充。用 80-120 字概括整本书主线，至少说明主角是谁、主角想达成什么目标、主要阻力是什么、故事会往哪个方向升级。\n- 主角目标：待补充\n- 核心冲突：待补充\n- 长线悬念：待补充\n- 结局方向：待补充\n\n## 主要角色与关系\n- 主角：待补充\n- 核心配角：待补充\n- 主要对手：待补充\n- 关键关系网：待补充\n\n## 写作风格\n- 叙事视角：待补充\n- 叙事语气：待补充\n- 节奏要求：待补充\n- 语言风格：待补充\n- 情绪基调：待补充\n- 平台适配重点：待补充\n- 禁写约束：待补充\n\n## 当前推进重点\n- 当前阶段：构思中\n- 当前进度：待补充\n- 当前卷 / 当前剧情位置：待补充\n- 下一步最重要动作：先补齐题材定位、剧情梗概和写作风格\n- 当前缺口：待补充\n\n## 建议优先补齐的项目文件\n- `01_设定/作品定位.md`：平台、题材、卖点、受众、篇幅方向。\n- `01_设定/剧情梗概.md`：全书主线、主角目标、主要冲突、阶段升级。\n- `01_设定/写作风格.md`：视角、语气、节奏、语言习惯、禁写项。\n- `01_设定/人物设定.md`：主角、重要配角、关系与动机。\n- `03_规划/章节规划.md`：当前卷的章节拆分、节奏安排和每章目标。\n\n## 维护提醒\n- 作品定位、剧情方向、重要人物关系、风格基线和阶段重点变化后，及时更新本文件。\n- 更细的连续性事实、阶段结论和返修记录，补充到 `.project/MEMORY/` 与 `status/` 文件。\n"
    )
}

pub(crate) fn create_project_status_template(book_name: &str) -> String {
    format!(
        "{{\n  \"bookName\": \"{book_name}\",\n  \"projectStage\": \"构思中\",\n  \"workspaceVersion\": 1,\n  \"primaryLanguage\": \"zh-CN\",\n  \"targetWordCount\": null,\n  \"currentWordCount\": 0,\n  \"writingMode\": \"长篇/短篇待定\",\n  \"storyProfile\": {{\n    \"platform\": \"待补充\",\n    \"genre\": \"待补充\",\n    \"subGenre\": \"待补充\",\n    \"targetAudience\": \"待补充\",\n    \"coreSellingPoint\": \"待补充\",\n    \"premise\": \"待补充\",\n    \"plotSynopsis100\": \"待补充：用 80-120 字概括整本书主线、主角目标、主要阻力和升级方向。\",\n    \"protagonistGoal\": \"待补充\",\n    \"coreConflict\": \"待补充\",\n    \"longlineSuspense\": \"待补充\",\n    \"endingDirection\": \"待补充\"\n  }},\n  \"writingStyle\": {{\n    \"narrativePerspective\": \"待补充\",\n    \"tone\": \"待补充\",\n    \"pace\": \"待补充\",\n    \"languageStyle\": \"待补充\",\n    \"emotionalTone\": \"待补充\",\n    \"platformAdaptation\": \"待补充\",\n    \"taboos\": [\n      \"待补充\"\n    ]\n  }},\n  \"directories\": {{\n    \"setting\": \"01_设定\",\n    \"draft\": \"02_正文\",\n    \"planning\": \"03_规划\",\n    \"projectMeta\": \".project\",\n    \"projectMemory\": \".project/MEMORY\",\n    \"projectStatus\": \".project/status\"\n  }},\n  \"defaultFiles\": {{\n    \"guide\": \".project/AGENTS.md\",\n    \"projectReadme\": \".project/README.md\",\n    \"projectState\": \".project/status/project-state.json\",\n    \"latestPlot\": \".project/status/latest-plot.json\",\n    \"characterState\": \".project/status/character-state.json\"\n  }},\n  \"recommendedFiles\": {{\n    \"projectReadme\": \".project/README.md\",\n    \"projectPositioning\": \"01_设定/作品定位.md\",\n    \"plotSynopsis\": \"01_设定/剧情梗概.md\",\n    \"writingStyle\": \"01_设定/写作风格.md\",\n    \"characterBible\": \"01_设定/人物设定.md\",\n    \"chapterPlan\": \"03_规划/章节规划.md\"\n  }},\n  \"aiInstructions\": [\n    \"开始任务前先读取 .project/AGENTS.md、.project/README.md、.project/status/project-state.json、.project/status/latest-plot.json 和 .project/status/character-state.json。\",\n    \"如 .project/MEMORY 下存在相关资料，按任务需要主动读取。\",\n    \"作品定位、剧情总览、风格基线、人物关系和阶段重点优先维护在 .project/README.md。\",\n    \"设定写入 01_设定，正文写入 02_正文，规划、参考资料和提纲写入 03_规划。\",\n    \"不要擅自重命名顶层目录。\",\n    \"新增章节时优先使用清晰且稳定的文件名。\",\n    \"剧情梗概、主角目标和写作风格缺失时，优先补齐 README 与设定文件，再推进长篇续写。\",\n    \"项目阶段、字数目标、结构调整、风格调整后要同步回写 project-state.json，必要时同步更新 README 与 MEMORY。\",\n    \"剧情推进后同步更新 latest-plot.json，人物即时状态变化后同步更新 character-state.json。\"\n  ],\n  \"status\": {{\n    \"currentFocus\": \"待明确题材、剧情梗概、主角目标与写作风格\",\n    \"nextAction\": \"先补齐 .project/README.md，再在 01_设定 中补齐作品定位、剧情梗概和写作风格，并在 03_规划 中建立章节规划\",\n    \"currentArc\": null,\n    \"lastUpdated\": null\n  }}\n}}\n"
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
                ".project/README.md",
                create_project_readme_template(book_name),
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
