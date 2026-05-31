// 图书工作区：默认模板生成与新书创建逻辑（写入真实文件）。

use crate::domains::book_workspace::data::{build_book_root_path, BookRecord};
use crate::domains::book_workspace::fs_store::{BookMeta, WorkspaceStore};
use crate::domains::book_workspace::search::rebuild_book_search_index;
use crate::infrastructure::workspace_paths::{now_timestamp, validate_name, CommandResult};
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

## 文件关联

工作区支持任意两个文件之间建立无向多对多关联(带自定义标签和可选备注)。建立关联后,处理 active file 时 AI 会自动看到关联文件的路径和标签提示,无需重复 search。

典型用法:
- `细纲 ↔ 人物设定`(标签如"出场人物")
- `细纲 ↔ 势力设定`(标签如"涉及势力")
- `人物 ↔ 人物`(标签如"师徒""敌对""血亲")
- `章节 ↔ 章节`(标签如"前置剧情""伏笔承接")
- `设定 ↔ 设定`(标签如"引用设定")

维护方式:
- AI 工具:`workspace_relation`(action=list/create/update/delete)。
- 手动:文件树点击文件行的关联图标(链接形状),弹出面板可新增/编辑/删除关联,也能跳转到对端文件。

约定:标签写人话,优先复用本书已有标签;只改备注用 update,不要为重命名标签频繁删建。

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
    store: &WorkspaceStore,
    book_name: &str,
) -> CommandResult<BookRecord> {
    let validated_name = validate_name(book_name)?;
    if store.find_book_by_name(&validated_name)?.is_some() {
        return Err("同名书籍已存在。".into());
    }

    let timestamp = now_timestamp();
    let book_id = Uuid::new_v4().to_string();
    let meta = BookMeta {
        id: book_id.clone(),
        name: validated_name.clone(),
        created_at: timestamp,
        updated_at: timestamp,
    };
    store.create_book_dir(&book_id, &meta)?;

    let (directories, files) = build_book_template(&validated_name);
    for directory in directories {
        store.create_dir(&book_id, directory)?;
    }
    for (relative_path, contents) in files {
        store.write_text(&book_id, relative_path, &contents)?;
    }

    rebuild_book_search_index(store, &book_id)?;

    Ok(BookRecord {
        id: book_id,
        name: validated_name.clone(),
        root_path: build_book_root_path(&validated_name),
        updated_at: timestamp,
    })
}
