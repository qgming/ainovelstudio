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

本文件定义本书工作区的事实源约定与回写契约。神笔写作主代理（system s00 Agent OS Kernel）会优先以本文件为准。

## Source Of Truth

- 工作区文件是本项目的唯一事实源；对话、灵感、临时分析必须落盘到文件后才算生效。
- `.project/AGENTS.md`（本文件）：工作区规则、命名、回写契约。
- `.project/README.md`：作品定位、剧情主线、人物关系、风格基线、当前重点。
- `.project/context-manifest.json`：不同任务类型的默认上下文装配策略。
- `.project/status/*.json`：机器可维护的真值层。
- `.project/canon/`：长篇稳定事实、人物 / 地点 / 伏笔 / 能力边界索引。
- `.project/style/`：作者声音、禁写句式、平台风格基线。
- `.project/chapters/`：章节摘要、章级 delta 与长篇压缩轨迹。
- `.project/evals/`：章节质检、连续性检查、风格检查记录。
- `.project/runs/`：章节 harness 阶段运行记录。
- `设定/`、`大纲/`、`正文/`：内容文件。

## Required Startup Reads

接到任务后按需读：

1. `.project/AGENTS.md`（本文件）
2. `.project/README.md`
3. `.project/context-manifest.json`：按任务类型决定补充读取哪些上下文。
4. `.project/status/project-state.json`：目录、命名、AI 协作约束、推荐文件。
5. `.project/status/system-state.json`：当前阶段、当前章节、活跃文件。
6. `.project/status/latest-plot.json`、`.project/status/character-state.json`：最近剧情、人物即时状态。
7. `.project/status/continuity-index.json`：伏笔、未回收线索、连续性风险、canon 入口。
8. `.project/MEMORY/README.md` 与相关记忆文件：长期资料按需读。
9. 任务明显匹配已启用 skill 时，用 `skill` 读取对应 `SKILL.md`；目录信息只用于定位 skill，不当作完整规则。

s14 项目默认上下文已注入的内容视为已读，不要重复 read。

## Directory Semantics

- `.project/`：工作区元数据，由 AI 与程序共同维护。
- `.project/MEMORY/`：长期可复用记忆（连续性专题、返修记录、阶段总结）；不是缓存区。
- `.project/status/`：机器可维护的状态 JSON 真值层。
- `.project/canon/`：稳定 canon 索引，服务超长篇一致性。
- `.project/style/`：文风、口吻、禁写约束与平台适配说明。
- `.project/chapters/`：章节摘要、delta、阶段压缩记录。
- `.project/evals/`：质检、连续性、风格审校记录。
- `.project/runs/`：章节生产 harness 的阶段记录。
- `设定/世界观/`：背景、规则、力量体系、历史、地理、职业、种族。
- `设定/角色/`：角色单文件，推荐 `设定/角色/角色名.md`。
- `设定/势力/`：组织 / 门派 / 国家 / 阵营单文件。
- `大纲/`：卷级大纲、章级细纲、阶段方案。
- `正文/`：章节正文、番外、修订稿、终稿。

## 文件命名规则

1. 章节正文：`正文/第001章_章名.md`，三位数字编号从 `001` 起递增。
2. 章级细纲：`大纲/细纲_第001章.md`，编号与对应正文一致。
3. 角色 / 势力：`设定/角色/角色名.md`、`设定/势力/势力名.md`。
4. 不要混用 `第一章`、`001_`、`chapter-1` 等格式。

## Skill Loading Rules

- 长篇写作、扫榜、拆文、润色、去 AI 味、工作流执行等任务，如果匹配已启用 skill，先读对应 `SKILL.md` 再执行。
- `s03` 技能目录只提供 skillId、简介和 references 数量；不要把目录简介当作完整方法论。
- 需要专项例子、模板或风格材料时，再按 `SKILL.md` 指引读取该 skill 的 `references/`。
- 派发 subagent 前，主代理先读取相关 skill，并把必要规则摘要放进子任务上下文。

## Write-Back Rules

| 内容类别 | 写入位置 |
|---|---|
| 作品定位、剧情总览、人物概览、风格、阶段重点 | `.project/README.md` |
| 目录约定、命名、AI 协作规则、推荐文件 | `.project/status/project-state.json` |
| 上下文装配策略 | `.project/context-manifest.json` |
| 当前阶段、最近章节、活跃文件、当前任务 | `.project/status/system-state.json` |
| 最新剧情推进 | `.project/status/latest-plot.json` |
| 人物即时状态 | `.project/status/character-state.json` |
| 伏笔、未回收线索、连续性风险、canon 入口 | `.project/status/continuity-index.json` |
| 长期复用专题、返修记录、阶段结论 | `.project/MEMORY/*.md` |
| 长篇稳定 canon、文风基线、章节摘要、质检记录 | `.project/canon/`、`.project/style/`、`.project/chapters/`、`.project/evals/` |
| 设定 / 大纲 / 正文 | `设定/`、`大纲/`、`正文/` |

最小修改原则：改已有文件优先 `edit` / `json`；整文件覆盖只在新建或全量重写时用 `write`。

## JSON State Rules

- 推进剧情后同步更新 `latest-plot.json`，必要时补 `continuity-index.json`。
- 角色状态变化后同步更新 `character-state.json`。
- 当前章节、活跃文件、阶段变化后同步更新 `system-state.json`。
- 目录、命名、AI 协作规则变化后同步更新 `project-state.json`。
- 用 `json` 工具按 JSON Pointer 增量更新，不要用 `write` 整文件覆盖 status JSON。

## Memory Rules

- 只把会影响后续创作 / 审稿 / 连续性判断的资料写进 `.project/MEMORY/`。
- 新建记忆前先读 `.project/MEMORY/README.md`，避免重复或冲突。
- 新建后把文件名与用途追加到 `MEMORY/README.md` 的索引。
- 即时状态、易变事实写入 `status/` JSON，不要进 MEMORY。

## Done Criteria

- 涉及创作 / 设定 / 大纲的产出已写回对应目录。
- 受影响的 status JSON 已增量同步。
- 一段简短中文摘要：本轮改了哪些文件、风险或下一步。
"#,
        book_name,
    )
}

pub(crate) fn create_project_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 项目 README

本文件记录这本书本身的执行性 brief。对话会默认加载本文件。规则、命名、回写契约见 `.project/AGENTS.md`。

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

- 叙事视角：待补充（推荐第三人称限知或第一人称，择一固定）
- 叙事语气：待补充
- 节奏要求：待补充
- 语言风格：待补充
- 情绪基调：待补充
- 平台适配重点：待补充
- 单章字数：默认汉字 2500-3500
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

- 作品定位、剧情方向、人物关系、风格、阶段重点变化后，及时更新本文件。
- 更细的连续性事实、阶段结论、返修记录补充到 `.project/MEMORY/` 与 `status/`。
"#,
        book_name,
    )
}

pub(crate) fn create_project_status_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "projectStage": "构思中",
  "workspaceVersion": 3,
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
    "chapterWordCountMin": 2500,
    "chapterWordCountMax": 3500,
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
    "projectStatus": ".project/status",
    "projectCanon": ".project/canon",
    "projectStyle": ".project/style",
    "projectChapters": ".project/chapters",
    "projectEvals": ".project/evals",
    "projectRuns": ".project/runs"
  },
  "defaultFiles": {
    "guide": ".project/AGENTS.md",
    "projectReadme": ".project/README.md",
    "contextManifest": ".project/context-manifest.json",
    "projectState": ".project/status/project-state.json",
    "systemState": ".project/status/system-state.json",
    "latestPlot": ".project/status/latest-plot.json",
    "characterState": ".project/status/character-state.json",
    "continuityIndex": ".project/status/continuity-index.json",
    "memoryGuide": ".project/MEMORY/README.md",
    "canonGuide": ".project/canon/README.md",
    "styleVoice": ".project/style/voice.md",
    "chapterSummaryGuide": ".project/chapters/README.md",
    "evalGuide": ".project/evals/README.md",
    "runGuide": ".project/runs/README.md"
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
	    "接到任务后先按 .project/AGENTS.md 的 Required Startup Reads 顺序读取必读文件。",
	    "已在 user s14 注入的项目默认上下文视为已读，不要重复 read。",
	    "任务明显匹配已启用 skill 时，先读取对应 SKILL.md，再执行创作、审校、润色或工作流。",
	    "改已有文件优先 edit / json；整文件覆盖只在新建或全量重写时用 write。",
    "推进剧情后同步更新 latest-plot.json 与 continuity-index.json。",
    "角色状态变化后同步更新 character-state.json。",
    "当前章节 / 活跃文件 / 阶段变化后同步更新 system-state.json。",
    "目录 / 命名 / AI 协作规则变化后同步更新 project-state.json。",
    "长篇稳定事实写入 .project/canon/；文风基线写入 .project/style/；章节摘要写入 .project/chapters/。",
    "章节生产过程写入 .project/runs/chapter-NNN.json，质检记录写入 .project/evals/。",
    "长期资料写入 .project/MEMORY/，并把文件名与用途追加到 .project/MEMORY/README.md 索引。"
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

本目录是长期可复用的项目记忆区，不是临时草稿。只有会影响后续创作、审稿或连续性判断的资料才写进来。

## 适合写入

- 连续性专题、伏笔索引、返修记录、阶段复盘。
- 平台适配约束、风格基线、题材红线。
- 跨多章复用的人物 / 关系 / 设定补充说明。

## 不适合写入

- 易变即时状态（写进 `.project/status/*.json`）。
- 只服务当前一次对话的临时草稿。
- 已经能在 status JSON 真值层稳定表达的字段。

## AI 自建记忆流程

1. 先读本文件与相关主题文件，确认没有现成记录。
2. 选稳定可检索的文件名：`continuity.md`、`foreshadowing.md`、`revision-log.md`、`platform-notes.md`。
3. 写入明确结论、适用范围、必要例子，避免空话套话。
4. 新建或更新后把文件名与用途追加到下方索引。
5. 记忆过时直接更新或删除，并同步修正索引。

## 建议格式

- 标题：主题名。
- 第一段：这份记忆解决什么问题。
- 主体：按条目记录稳定事实、检查点或返修规则。
- 时间线类用可排序的小标题或列表。

## 当前记忆索引

- 暂无。新增后追加：`- 文件名.md：一句话说明用途`
"#,
        book_name,
    )
}

pub(crate) fn create_context_manifest_template(book_name: &str) -> String {
    render_book_template(
        r#"{
  "bookName": "{BOOK_NAME}",
  "version": 1,
  "policies": [
    {
      "taskType": "book-design",
      "alwaysInclude": [
        ".project/AGENTS.md",
        ".project/README.md",
        ".project/status/project-state.json",
        ".project/MEMORY/README.md"
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
	      "taskType": "autopilot",
	      "alwaysInclude": [
	        ".project/AGENTS.md",
	        ".project/README.md",
	        ".project/context-manifest.json",
	        ".project/status/project-state.json",
	        ".project/status/system-state.json",
	        ".project/status/latest-plot.json",
	        ".project/status/character-state.json",
	        ".project/status/continuity-index.json",
	        ".project/canon/README.md",
	        ".project/style/voice.md",
	        ".project/chapters/README.md",
	        ".project/runs/README.md"
	      ],
	      "includeIfActive": [
	        "大纲/大纲.md"
	      ],
	      "summaryFirst": [
	        ".project/runs/README.md",
	        ".project/chapters/README.md",
	        ".project/canon/README.md"
	      ],
	      "fullReadTriggers": [
	        "YOLO",
	        "全自动",
	        "目标",
	        "续写",
	        "审校",
	        "回写"
	      ],
	      "charBudget": 32000,
	      "priority": 50
	    },
	    {
	      "taskType": "flow",
	      "alwaysInclude": [
        ".project/AGENTS.md",
        ".project/README.md",
        ".project/context-manifest.json",
        ".project/status/system-state.json",
        ".project/status/latest-plot.json",
        ".project/status/character-state.json",
        ".project/status/continuity-index.json",
        ".project/canon/README.md",
        ".project/style/voice.md",
        ".project/chapters/README.md",
        ".project/runs/README.md"
      ],
      "includeIfActive": [
        "大纲/大纲.md"
      ],
      "summaryFirst": [
        ".project/runs/README.md",
        ".project/chapters/README.md",
        ".project/canon/README.md"
      ],
	      "fullReadTriggers": [
	        "工作流",
	        "harness",
	        "技能",
	        "续写",
	        "审校",
        "回写"
      ],
      "charBudget": 28000,
      "priority": 40
    },
    {
      "taskType": "chapter-write",
      "alwaysInclude": [
        ".project/AGENTS.md",
        ".project/README.md",
        ".project/status/system-state.json",
        ".project/status/latest-plot.json",
        ".project/status/character-state.json",
        ".project/status/continuity-index.json",
        ".project/canon/README.md",
        ".project/style/voice.md",
        ".project/chapters/README.md"
      ],
      "includeIfActive": [
        "大纲/大纲.md"
      ],
      "summaryFirst": [
        ".project/chapters/README.md",
        ".project/canon/README.md"
      ],
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
        ".project/status/continuity-index.json",
        ".project/canon/README.md",
        ".project/chapters/README.md"
      ],
      "includeIfActive": [],
      "summaryFirst": [
        ".project/canon/README.md",
        ".project/chapters/README.md"
      ],
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

pub(crate) fn create_canon_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} Canon 索引

本目录记录超长篇稳定事实。只有会影响后续章节一致性的事实写入这里。

## 建议文件

- `characters.md`：人物身份、目标、关系、能力边界。
- `timeline.md`：关键时间线、卷级节点、已发生事件。
- `world-rules.md`：世界观规则、力量体系、代价与限制。
- `foreshadowing.md`：伏笔、未回收线索、回收章节。

## 写入规则

- 写稳定结论，不写临时猜测。
- 新 canon 必须能追溯到正文、设定、状态 JSON 或作者明确指令。
- 与旧 canon 冲突时，先标记冲突和来源，再修改正文或 canon。
"#,
        book_name,
    )
}

pub(crate) fn create_style_voice_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 文风基线

本文件记录作者声音、叙事节奏、禁写项与平台适配要求。

## 基线

- 叙事视角：待补充
- 语言密度：待补充
- 对话风格：待补充
- 情绪基调：待补充
- 单章节奏：2500-3500 汉字，单章一个核心冲突，一个主爽点，一个章末钩子。

## 禁写

- 待补充。

## 维护规则

- 润色和去 AI 味时以本文件为风格事实源。
- 风格变更后同步更新 `.project/README.md` 的写作风格摘要。
"#,
        book_name,
    )
}

pub(crate) fn create_chapters_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 章节摘要索引

本目录保存长篇压缩轨迹，服务近 30 章摘要与跨卷回顾。

## 建议文件

- `chapter-001.json`：单章摘要、CanonDelta、质量检查结果。
- `volume-01.md`：卷级阶段复盘。

## 摘要字段

- 章节号、标题、核心冲突、爽点兑现、人物变化、信息释放、章末钩子、CanonDelta。
"#,
        book_name,
    )
}

pub(crate) fn create_evals_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} Evals

本目录记录章节质检、连续性检查、文风检查和发布前检查。

## 检查类型

- `continuity-review`：人物、时间线、伏笔、战力边界。
- `style-polish`：作者声音、AI 味、禁写词、节奏。
- `final-check`：字数、章内冲突、章末钩子、状态回写。
"#,
        book_name,
    )
}

pub(crate) fn create_runs_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} Chapter Runs

本目录保存章节生产 harness 的阶段记录。

## 阶段

`chapter-plan -> draft -> continuity-review -> style-polish -> state-maintain -> final-check`

## 文件命名

- `.project/runs/chapter-001.json`
- `.project/runs/chapter-002.json`

运行记录用于暂停、恢复、重放和排查失败原因。
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
            ".project/canon",
            ".project/chapters",
            ".project/evals",
            ".project/runs",
            ".project/style",
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
                ".project/context-manifest.json",
                create_context_manifest_template(book_name),
            ),
            (
                ".project/MEMORY/README.md",
                create_memory_readme_template(book_name),
            ),
            (
                ".project/canon/README.md",
                create_canon_readme_template(book_name),
            ),
            (
                ".project/style/voice.md",
                create_style_voice_template(book_name),
            ),
            (
                ".project/chapters/README.md",
                create_chapters_readme_template(book_name),
            ),
            (
                ".project/evals/README.md",
                create_evals_readme_template(book_name),
            ),
            (
                ".project/runs/README.md",
                create_runs_readme_template(book_name),
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
