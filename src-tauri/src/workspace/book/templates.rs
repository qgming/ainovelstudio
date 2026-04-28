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

fn render_book_template(template: &str, book_name: &str) -> String {
    template.replace("{BOOK_NAME}", book_name)
}

pub(crate) fn create_project_agents_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 工作区 AGENTS

你正在处理一本网络小说项目工作区。工作区文件是这本书的唯一事实源；对话里的判断、灵感和临时分析，只有回写到文件后才算生效。

## 建议起手读取顺序
1. `.project/AGENTS.md`：理解目录结构、命名规则、回写要求和协作边界。
2. `.project/README.md`：理解作品定位、故事总览、角色关系、写作风格和当前重点。
3. `.project/status/project-state.json`：核对目录约定、默认文件、命名规范和真值层字段。
4. `.project/status/system-state.json`：核对当前工作阶段、正在处理的章节、活跃文件和最新同步点。
5. `.project/status/latest-plot.json` 与 `.project/status/character-state.json`：核对最近剧情推进与人物即时状态。
6. `.project/status/continuity-index.json`：核对伏笔、未回收线索、连续性风险和关键 canon 入口。
7. `.project/MEMORY/README.md` 与相关记忆文件：按任务需要读取长期资料、返修记录和专题结论。
8. 相关设定、大纲、正文文件：再进入具体创作、改写、审稿或同步。

## 工作区结构
- `.project/AGENTS.md`：工作区规则、命名规范、文件分工、技能与工作流入口。
- `.project/README.md`：作品说明与当前推进总览；优先记录定位、主线、风格和阶段目标。
- `.project/status/project-state.json`：项目结构化状态真值层；记录目录、默认文件、命名规则和 AI 协作约束。
- `.project/status/system-state.json`：当前系统工作状态；记录最近处理章节、当前任务、活跃文件和同步节奏。
- `.project/status/latest-plot.json`：最近剧情推进、当前冲突、下一步推进预期。
- `.project/status/character-state.json`：角色即时状态、关系变化、关键资源和受伤/成长情况。
- `.project/status/continuity-index.json`：伏笔索引、未回收线索、连续性风险和 canon 快速入口。
- `.project/MEMORY/README.md`：本书长期记忆目录说明与索引。
- `.project/MEMORY/`：可持续更新的长期记忆目录；适合存放连续性专题、返修记录、阶段总结、题材约束和稳定经验。
- `设定/`：作品设定总目录。
- `设定/世界观/`：背景、规则、力量体系、历史、地理、职业、种族等。
- `设定/角色/`：角色单文件设定，推荐 `设定/角色/角色名.md`。
- `设定/势力/`：组织、门派、国家、公司、阵营等单文件设定。
- `大纲/`：卷级大纲、章级细纲、阶段方案与节奏拆分。
- `正文/`：章节正文、番外、修订稿、终稿。

## 文件命名规则
1. 章节正文文件统一使用 `正文/第001章_章名.md` 格式。
2. `第001章` 的编号必须使用三位数字，从 `001` 开始递增，保证文件夹内稳定排序。
3. 章节细纲统一使用 `大纲/细纲_第001章.md` 格式，编号与对应正文一致。
4. 角色、势力文件优先使用稳定实体名命名，例如 `设定/角色/沈栀.md`、`设定/势力/天机阁.md`。
5. 不要擅自混用 `第一章`、`001_`、`chapter-1` 等其他格式。

## 文件分工与回写要求
1. 作品定位、剧情总览、人物概览、风格基线、阶段重点，优先写入 `.project/README.md`。
2. 目录约定、默认文件、命名规则、AI 协作规则、阶段状态，写入 `.project/status/project-state.json`。
3. 当前工作阶段、最近处理章节、活跃文件、当前任务，写入 `.project/status/system-state.json`。
4. 最新剧情推进写入 `.project/status/latest-plot.json`；人物即时变化写入 `.project/status/character-state.json`。
5. 伏笔、悬念、未回收线索、连续性风险、关键 canon 入口，写入 `.project/status/continuity-index.json`。
6. 长期有效且会影响后续判断的专题资料、返修记录、阶段结论，写入 `.project/MEMORY/` 对应文件。
7. 设定类内容写入 `设定/`；大纲、细纲、方案写入 `大纲/`；章节正文写入 `正文/`。
8. 临时分析如果后续还要复用，必须落盘到工作区文件，不能只留在对话里。

## MEMORY 使用规则
1. `.project/MEMORY/` 不是缓存区，而是长期可复用记忆区；只有会影响后续创作、审稿或连续性判断的内容才写进去。
2. AI 可以按任务需要主动新建记忆文件，例如 `continuity.md`、`foreshadowing.md`、`revision-log.md`、`platform-notes.md`。
3. 新建记忆前先读取 `.project/MEMORY/README.md` 和相关主题文件，避免重复或冲突。
4. 新建记忆后要把文件名与用途补到 `.project/MEMORY/README.md` 的索引里。
5. 记忆文件名保持主题稳定、可检索，不要使用 `临时记录1.md` 这类不可读名称。
6. 会被剧情更新推翻的即时状态，不写 MEMORY，优先写入 `status/` 的 JSON 真值层。

## JSON 状态维护规则
- 读取项目时，默认先核对 `.project/status/project-state.json`、`.project/status/system-state.json`、`.project/status/latest-plot.json`、`.project/status/character-state.json`。
- 推进剧情后，同步更新 `latest-plot.json`，必要时补充 `continuity-index.json`。
- 角色状态变化后，同步更新 `character-state.json`。
- 工作阶段、当前处理章节、活跃文件变化后，同步更新 `system-state.json`。
- 目录、命名规范、默认文件或协作规则变化后，同步更新 `project-state.json`。

## 代理与工作流建议
- 市场与赛道判断：委派 `market-scout`
- 对标书拆解、节奏分析、爆点复盘：委派 `story-analyst`
- 长篇开书、大纲、续写章节：委派 `long-novelist`
- 短篇构思、短篇成稿：委派 `short-novelist`
- 连续性维护、状态同步、设定回写：委派 `continuity-keeper`
- 终稿质检、去 AI 味、统一文风：委派 `manuscript-polisher`

推荐工作流：
- 长篇连载推进：`builtin:long-novel-serial`
- 短篇集批量创作：`builtin:short-story-factory`
- 选题前调研拆文：`builtin:market-research-cycle`

常用 skill：
- 长篇：`story-long-scan` / `story-long-analyze` / `story-long-write`
- 短篇：`story-short-scan` / `story-short-analyze` / `story-short-write`
- 去 AI 味与终稿整理：`story-deslop`

## 默认写作要求
- 生成正文前，先核对 `.project/README.md`、相关设定、相关大纲、最近正文和状态文件。
- 章节正文优先围绕主角目标、核心冲突和阶段 payoff 推进。
- 每章至少有一个明确推进点，并在章末留下钩子。
- 命名、目录、字段保持稳定，方便批量读取和自动化处理。
- 当作品定位、人物关系、风格基线或阶段目标变化时，先回写 README 与 JSON 状态，再继续创作。
"#,
        book_name,
    )
}

pub(crate) fn create_project_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 项目 README

本文件用于记录这本书本身的信息。对话和工作流会默认加载本文件，用它快速理解作品定位、剧情主线、风格、人物关系和当前推进重点。工作区规则、工具约定和回写要求，统一查看 `.project/AGENTS.md`。

## 作品定位
- 书名：`{BOOK_NAME}`
- 平台：待补充
- 写作模式：长篇 / 短篇待定
- 题材大类：待补充
- 细分题材：待补充
- 目标读者：待补充
- 目标字数：待补充
- 核心卖点：待补充
- 一句话 premise：待补充

## 故事总览
- 剧情梗概（100 字左右）：待补充。用 80-120 字概括整本书主线，至少说明主角是谁、主角想达成什么目标、主要阻力是什么、故事会往哪个方向升级。
- 主角目标：待补充
- 核心冲突：待补充
- 长线悬念：待补充
- 结局方向：待补充

## 主要角色与关系
- 主角：待补充
- 核心配角：待补充
- 主要对手：待补充
- 关键关系网：待补充

## 写作风格
- 叙事视角：待补充
- 叙事语气：待补充
- 节奏要求：待补充
- 语言风格：待补充
- 情绪基调：待补充
- 平台适配重点：待补充
- 禁写约束：待补充

## 当前推进重点
- 当前阶段：构思中
- 当前进度：待补充
- 当前卷 / 当前剧情位置：待补充
- 下一步最重要动作：先补齐题材定位、剧情梗概、写作风格和卷级大纲
- 当前缺口：待补充

## 建议优先补齐的项目文件
- `设定/作品定位.md`：平台、题材、卖点、受众、篇幅方向。
- `设定/剧情梗概.md`：全书主线、主角目标、主要冲突、阶段升级。
- `设定/写作风格.md`：视角、语气、节奏、语言习惯、禁写项。
- `设定/角色/主角.md`：主角的目标、动机、弱点、成长线。
- `大纲/大纲.md`：全书卷级结构、每卷功能和核心事件。
- `大纲/细纲_第001章.md`：开篇章节目标、钩子、爽点和章尾悬念。
- `正文/第001章_章名.md`：按命名规范产出正文章节。

## 维护提醒
- 作品定位、剧情方向、重要人物关系、风格基线和阶段重点变化后，及时更新本文件。
- 更细的连续性事实、阶段结论和返修记录，补充到 `.project/MEMORY/` 与 `status/` 文件。
"#,
        book_name,
    )
}

pub(crate) fn create_project_status_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "projectStage": "构思中",
  "workspaceVersion": 2,
  "primaryLanguage": "zh-CN",
  "targetWordCount": null,
  "currentWordCount": 0,
  "writingMode": "长篇/短篇待定",
  "storyProfile": {
    "platform": "待补充",
    "genre": "待补充",
    "subGenre": "待补充",
    "targetAudience": "待补充",
    "coreSellingPoint": "待补充",
    "premise": "待补充",
    "plotSynopsis100": "待补充：用 80-120 字概括整本书主线、主角目标、主要阻力和升级方向。",
    "protagonistGoal": "待补充",
    "coreConflict": "待补充",
    "longlineSuspense": "待补充",
    "endingDirection": "待补充"
  },
  "writingStyle": {
    "narrativePerspective": "待补充",
    "tone": "待补充",
    "pace": "待补充",
    "languageStyle": "待补充",
    "emotionalTone": "待补充",
    "platformAdaptation": "待补充",
    "taboos": [
      "待补充"
    ]
  },
  "directories": {
    "setting": "设定",
    "worldbuilding": "设定/世界观",
    "characters": "设定/角色",
    "factions": "设定/势力",
    "outline": "大纲",
    "draft": "正文",
    "projectMeta": ".project",
    "projectMemory": ".project/MEMORY",
    "projectStatus": ".project/status"
  },
  "defaultFiles": {
    "guide": ".project/AGENTS.md",
    "projectReadme": ".project/README.md",
    "projectState": ".project/status/project-state.json",
    "systemState": ".project/status/system-state.json",
    "latestPlot": ".project/status/latest-plot.json",
    "characterState": ".project/status/character-state.json",
    "continuityIndex": ".project/status/continuity-index.json",
    "memoryGuide": ".project/MEMORY/README.md"
  },
  "recommendedFiles": {
    "projectReadme": ".project/README.md",
    "projectPositioning": "设定/作品定位.md",
    "plotSynopsis": "设定/剧情梗概.md",
    "writingStyle": "设定/写作风格.md",
    "characterBible": "设定/角色/主角.md",
    "outline": "大纲/大纲.md",
    "chapterPlan": "大纲/细纲_第001章.md",
    "firstChapter": "正文/第001章_章名.md",
    "notes": "笔记.md"
  },
  "namingRules": {
    "chapterDraft": "正文/第001章_章名.md",
    "chapterOutline": "大纲/细纲_第001章.md",
    "characterFile": "设定/角色/角色名.md",
    "factionFile": "设定/势力/势力名.md"
  },
  "aiInstructions": [
    "开始任务前先读取 .project/AGENTS.md、.project/README.md、.project/status/project-state.json、.project/status/system-state.json、.project/status/latest-plot.json 和 .project/status/character-state.json。",
    "如 .project/MEMORY 下存在相关资料，先读取 .project/MEMORY/README.md，再按任务需要读取相关主题文件。",
    "作品定位、剧情总览、风格基线、人物关系和阶段重点优先维护在 .project/README.md。",
    "设定写入 设定，卷级与章级规划写入 大纲，章节正文写入 正文。",
    "新增正文文件时统一使用 正文/第001章_章名.md 格式，编号固定三位数字。",
    "新增章级细纲时统一使用 大纲/细纲_第001章.md 格式，并与对应正文编号一致。",
    "需要长期复用的专题资料可以在 .project/MEMORY 中主动新建 Markdown 文件，并同步更新 .project/MEMORY/README.md 索引。",
    "项目阶段、目录约定、命名规范、默认文件或协作规则调整后要同步回写 project-state.json。",
    "剧情推进后同步更新 latest-plot.json 与 continuity-index.json，人物即时状态变化后同步更新 character-state.json。",
    "当前任务、活跃文件、最近处理章节变化后同步更新 system-state.json。"
  ],
  "status": {
    "currentFocus": "待明确题材、剧情梗概、主角目标、写作风格与卷级大纲",
    "nextAction": "先补齐 .project/README.md，再在 设定 中补齐作品定位、剧情梗概和写作风格，并在 大纲 中建立大纲与第001章细纲",
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
  "activeWorkflow": null,
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
  "canonRefs": {
    "characters": [],
    "worldbuilding": [],
    "factions": [],
    "chapters": []
  },
  "updatedAt": null
}
"#,
        book_name,
    )
}

pub(crate) fn create_memory_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} MEMORY 说明

本目录用于存放会被后续章节、审稿、设定同步重复引用的长期资料。这里不是聊天草稿区，只有值得复用的内容才落盘到这里。

## 适合写入的内容
- 连续性专题、伏笔索引、返修记录、阶段复盘。
- 平台适配约束、风格基线、题材红线。
- 需要跨多章复用的人物、关系、设定补充说明。

## 不适合写入的内容
- 刚发生且很快会变化的即时状态。
- 只服务当前一次对话的临时草稿。
- 已经能在 `status/` JSON 真值层稳定表达的字段。

## AI 自建记忆流程
1. 先读本文件和相关主题文件，确认没有现成记录。
2. 选择稳定、可检索的文件名，例如 `continuity.md`、`foreshadowing.md`、`revision-log.md`。
3. 写入明确结论、适用范围和必要例子，避免空泛套话。
4. 新建或更新后，把文件补到下方索引。
5. 如果记忆已过时，直接更新或删除旧文件，并同步修正索引。

## 建议格式
- 标题：主题名。
- 第一段：这份记忆解决什么问题。
- 主体：按条目记录稳定事实、检查点或返修规则。
- 如需时间线，使用可排序的小标题或列表。

## 当前记忆索引
- 暂无。新增记忆后在这里追加：`- 文件名.md：一句话说明用途`
"#,
        book_name,
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
            "设定",
            "设定/世界观",
            "设定/角色",
            "设定/势力",
            "大纲",
            "正文",
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
                ".project/MEMORY/README.md",
                create_memory_readme_template(book_name),
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
