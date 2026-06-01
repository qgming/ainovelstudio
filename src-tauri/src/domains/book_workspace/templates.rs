// 图书工作区：默认模板生成与新书创建逻辑（写入真实文件）。

use crate::domains::book_workspace::data::{build_book_root_path, BookRecord};
use crate::domains::book_workspace::fs_store::{BookMeta, WorkspaceStore};
use crate::domains::book_workspace::search::rebuild_book_search_index;
use crate::infrastructure::workspace_paths::{now_timestamp, validate_name, CommandResult};
use uuid::Uuid;

fn render_book_template(template: &str, book_name: &str) -> String {
    template.replace("{BOOK_NAME}", book_name)
}

pub(crate) fn create_project_readme_template(book_name: &str) -> String {
    render_book_template(
        r#"# {BOOK_NAME} 项目入口

本文件是这本书的唯一项目入口:既是创作 brief,也是本书的项目级约定。通用主代理人设由全局 AGENTS 提供,本文件只补充本书特有的内容。保持短,但要足够指导 AI 和作者继续推进。

## 协作目标

你和作者共享这个图书工作区。任务不是只给建议,而是把作者当前目标推进成可用成果:作品 brief、大纲、细纲、正文、设定或审稿结论。

能直接完成的任务就直接完成;需要选择题材、视角、主线、风格等关键方向时再问。问之前先看本书已有资料,避免让作者重复交代。

## 作品定位

- 书名:`{BOOK_NAME}`
- 平台:待补充
- 类型:长篇 / 短篇待定
- 题材:待补充
- 目标读者:待补充
- 目标字数:待补充
- 一句话设定:待补充
- 核心卖点:待补充
- 读者承诺:待补充。读者点开这本书,预期持续获得什么爽感、情绪或新鲜感。
- 开篇承诺:待补充。前 3 章要让读者相信什么、期待什么。

## 故事总览

- 剧情梗概:待补充。用 80-120 字说明主角、目标、阻力、升级方向和阶段回报。
- 主角目标:待补充。要能转化成具体行动。
- 核心冲突:待补充
- 升级路径:待补充
- 主要反转:待补充
- 结局方向:待补充

## 写作风格

- 叙事视角:待补充
- 语言风格:待补充
- 情绪基调:待补充
- 单章字数:默认 2500-3500 汉字
- 禁写约束:待补充
- 节奏偏好:待补充。例:快节奏打脸、慢热悬疑、强情绪拉扯。
- 对话口味:待补充。例:短句、有来有回、口语感强。

## 目录约定

- `设定/`:人物、世界观、势力、道具、规则等设定资料。
- `大纲/`:全书大纲、卷纲、章纲、阶段方案。
- `正文/`:章节正文、番外、修订稿、终稿。
- `.project/memory/`:项目长期记忆(Markdown),记录稳定事实、当前进度、伏笔台账等。

## 命名规则

1. 章节正文:`正文/第001章_章名.md`。
2. 章级细纲:`大纲/细纲_第001章.md`。
3. 设定文件按主题命名,例如 `设定/主角.md`、`设定/世界观.md`。
4. 同一类型文件保持一种编号和命名格式。

## 事实源优先级

资料冲突时:已经写入的正文事实优先;其次是 `.project/memory/` 与设定;再其次是本文件与旧对话。作者最新明确要求优先于旧资料。

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

## 项目记忆维护约定

- 记忆放 `.project/memory/`,由 AI 在创作中按需新建任意 `.md` 文件(人物、伏笔台账、世界观、时间线、剧情等),文件名和拆分由 AI 决定。
- **每个记忆文件顶部必须写 frontmatter**,程序据此扫描出"这本书有哪些记忆、各管什么",AI 才能按需精读:

  ```
  ---
  name: 主角-林川
  description: |
    主角林川的核心设定与当前状态。
    Use when: 写林川出场 / 核对能力边界、性格、底线时读。
  type: character        # project | character | setting | plot | foreshadow | timeline | style | other
  updated: 第023章 / 2025-01-01
  ---
  ```

- **写什么**:稳定设定、作者已确认偏好、已落地规划、明确待办、已埋伏笔与预计回收章。尽量在 `updated` 标来源(第N章/设定文件)。
- **不写**:临时想法、长篇推理过程、一次性闲聊、易变的当前草稿状态。
- **必须维护一份伏笔台账**(`type: foreshadow`):记录已埋 / 待回收[预计回收章] / 已回收。推进剧情或写新章时主动核对"待回收",回收后移入"已回收",新埋伏笔登记并标预计回收章。
- 优先用 `workspace_edit` 局部更新记忆;新建记忆用 `workspace_write`;检索记忆用 `workspace_search` / `workspace_grep` 并限定 `.project/memory/` 范围。

## 创作判断

- 本书的既有文风优先。改文前先判断原文想要达成的情绪和节奏。
- 大纲必须能指导写作:每个关键节点要有行动、阻力、反转和结果。
- 设定必须能落到人物选择、场景动作和剧情后果上。
- 审稿要指出真实问题:哪里拖、哪里空、哪里不可信、哪里爽点不足、哪里文风跑偏。
- 不确定的事实不要编成设定。需要推断时明确说这是推断。

## 正文基本规则(网文通用基线)

这是写正文的底线,任何章节都适用;详细技法见 `story-prose-craft` 技能,成稿清 AI 味见 `story-deslop` 技能。

- 视角锁定:只写当前视角人物能感知、推断或误判的内容,不用上帝视角透露角色不知道的事。
- 画面优先:用具体动作、名词、声音承载画面,少用空泛形容词、古风虚词和 AI 套话。
- 对话像人话:对话有来有回、服务当下目的,保留口语毛边,少用"说道 / 问道"标签。
- 节奏有呼吸:长短句交错,关键处短句发力;忌一段里每句字数雷同、匀速平铺(AI 节奏)。
- 标点干净:禁破折号;省略号只用于真实停顿;感叹号一段最多一个。
- 不写 AI 套话:见"眼中闪过 / 嘴角勾起 / 这一刻他明白"即换成动作反应;段末忌总结、升华、点题。
- 章末留钩子:用未完成动作、反转、危险、选择或情绪裂口收尾,给读者继续读的理由。

## 首轮建议补齐

- `.project/memory/project.md`(作品定位、当前阶段、目标)
- `设定/作品定位.md`、`设定/主角.md`、`设定/世界观.md`
- `大纲/大纲.md`、`大纲/细纲_第001章.md`
- `正文/第001章_章名.md`
"#,
        book_name,
    )
}

pub(crate) fn create_memory_index_template(book_name: &str) -> String {
    render_book_template(
        r#"---
name: 记忆导览
description: |
  《{BOOK_NAME}》项目记忆的导览与维护规则。
  Use when: 不清楚记忆怎么组织、要新建记忆文件、或需要整理记忆时读。
type: project
updated: 初始化
---

# {BOOK_NAME} 项目记忆导览

本目录是这本书的长期记忆。每个 `.md` 文件记录一类稳定事实,由 AI 在创作中按需新建。
系统会**自动扫描本目录每个文件的 frontmatter** 生成"记忆清单"注入对话,你无需手动维护索引——
只要保证每个记忆文件顶部的 frontmatter 写对即可。

## 文件 frontmatter 规范

每个记忆文件顶部必须有:

```
---
name: 文件主题(人读名,如 主角-林川 / 伏笔台账 / 世界观-修炼体系)
description: |
  一句话说明这个文件记录什么。
  Use when: 写明"什么任务/什么时候该读这个文件"。
type: project | character | setting | plot | foreshadow | timeline | style | other
updated: 来源章节 / 日期(如 第023章 / 2025-01-01)
---
```

## 写什么 / 不写什么

- **写**:稳定设定、作者已确认偏好、已落地规划、明确待办、已埋伏笔与预计回收章。尽量标来源。
- **不写**:临时想法、长篇推理过程、一次性闲聊、易变的当前草稿状态。

## 必备记忆

- **伏笔台账**(`type: foreshadow`):记录已埋 / 待回收[预计回收章] / 已回收。
  推进剧情或写新章时主动核对"待回收",回收后移入"已回收",新埋伏笔登记并标预计回收章。

## 常见记忆文件(按需新建,文件名自定)

- `project.md`(`type: project`):作品定位、当前阶段、近期目标、下一步。
- `主角-XXX.md`、`配角-XXX.md`(`type: character`):人物设定、当前状态、关系、秘密、能力边界。
- `世界观-XXX.md`、`势力-XXX.md`(`type: setting`):世界规则、组织、能力体系。
- `主线.md`、`第N卷-剧情.md`(`type: plot`):主线、当前剧情位置、最近事件、未解决问题。
- `伏笔台账.md`(`type: foreshadow`):见上。
- `时间线.md`(`type: timeline`):按故事内时间排序的关键事件 + 所在章节。
"#,
        book_name,
    )
}

pub(crate) fn create_memory_project_template(book_name: &str) -> String {
    render_book_template(
        r#"---
name: 项目状态
description: |
  《{BOOK_NAME}》的作品定位、当前阶段、近期目标与下一步。
  Use when: 确认创作方向、当前进度、活跃文件或下一步该做什么时读。
type: project
updated: 初始化
---

# {BOOK_NAME} 项目状态

## 作品定位

- 题材 / 类型:待补充
- 目标读者 / 平台:待补充
- 核心卖点 / 读者承诺:待补充

## 当前阶段

- 阶段:构思中
- 当前卷 / 当前章节:待补充
- 活跃文件:待补充

## 近期目标

- 待补充

## 阻塞点

- 题材未定 / 读者承诺未定 / 主角目标未定

## 下一步

- 先补齐作品定位与开篇方向,再建立大纲和第001章细纲。
"#,
        book_name,
    )
}

pub(crate) fn build_book_template(
    book_name: &str,
) -> (Vec<&'static str>, Vec<(&'static str, String)>) {
    (
        vec![".project", ".project/memory", "设定", "大纲", "正文"],
        vec![
            (
                ".project/README.md",
                create_project_readme_template(book_name),
            ),
            (
                ".project/memory/index.md",
                create_memory_index_template(book_name),
            ),
            (
                ".project/memory/project.md",
                create_memory_project_template(book_name),
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
