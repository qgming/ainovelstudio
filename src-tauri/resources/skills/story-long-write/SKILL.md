---
name: story-long-write
description: |
  长篇网文写作的执行手册。覆盖长篇开书、卷纲、细纲、人物 / 世界观、章节正文与连续推进。
  Use when: 用户要开长篇 / 写长篇大纲 / 写长篇正文 / 续写章节 / 推进连载，或长篇作者工作流节点执行任务时调用。
  触发方式：/story-long-write、/写长篇、「帮我开书」「写大纲」「续写下一章」
---

# story-long-write

把一个长篇网文项目从立项稳定推进到日更连载。本手册只给执行规则；具体技法在 `references/` 中按需读。

## Use When

- 用户要开新长篇、写卷级大纲或前 30 章细纲。
- 用户要写当前卷的某一章正文、续写下一章、或按 revision_brief 返修当前章。
- 长篇相关工作流节点执行供料、连续性检查、状态维护、章节质检或润色任务。
- 正文、续写章节、卷纲、细纲由主代理串行直写，专项节点只补充材料、诊断、检查或修改建议。

## Inputs To Read

接到任务后必读：

- `.project/AGENTS.md`、`.project/README.md`：风格、字数、禁写约束。
- `.project/status/project-state.json`、`system-state.json`、`latest-plot.json`、`character-state.json`。
- 上一章 / 最近 1-3 章正文（续写或返修时）。
- 当前卷的卷级大纲、当前章节细纲（若有）。
- 本章涉及的角色 / 势力 / 世界观设定。

## Procedure

### 立项阶段（无项目或刚开新书）

1. 用 `ask_user` 向作者确认题材方向、目标平台、目标字数（除非主提示词已明确）。
2. 写 `设定/作品定位.md`、`设定/剧情梗概.md`、`设定/写作风格.md`、`设定/角色/主角.md`。
3. 写 `大纲/大纲.md`（卷级结构）+ `大纲/细纲_第001章.md` 至 `细纲_第00X章.md`（前 3-5 章）。

### 续写阶段（已有项目）

1. 读 `.project/status/system-state.json` 拿到当前章节号与活跃文件。
2. 读上一章正文与当前章细纲（若无则先补）。
3. 写 `正文/第NNN章_章名.md`：开篇 200 字内有具体场景或冲突；单章一个核心冲突 + 1-2 个推进点 + 一个主爽点；章末必留钩子。
4. 字数符合 README / AGENTS 约定（默认汉字 2500-3500），写完用 `text_stats` 复核。

### 返修阶段（收到 revision_brief）

1. 读 revision_brief 与最近一次审稿结论。
2. 用 `workspace_edit` 做最小修改，只动当前章及其直接相关文件。
3. 不要顺手改下一章或重写整章。

## Execution Detail

### 单章规划

1. 先读最近剧情与上一章结尾，确认本章承接点、人物当前目标、冲突余波。
2. 再读本章相关设定，列出本章不能违背的 canon：人物已知信息、能力边界、地点限制、时间顺序。
3. 细纲必须写清：本章作用、开场状态、核心冲突、场景顺序、主爽点、信息释放、章末钩子。
4. 若现有细纲与正文事实冲突，以正文和状态文件为准修订细纲。

### 章节正文

1. 开篇 200 字内进入具体场景、行动或冲突，不用天气 / 背景说明开场。
2. 单章只押一个核心冲突，附 1-2 个推进点；每个推进点都要改变人物处境、信息差或资源状态。
3. 对话要推动关系和冲突，避免角色把设定完整讲给读者听。
4. 章末钩子必须是可继续追读的未完成动作、反转、危险、选择或情绪裂口。
5. 写完后用 `text_stats` 复核字数；低于项目约定时补冲突推进，高于约定时删解释和重复心理。

## Quality Gates

- **连续性**：上一章停点、本章时间、人物已知信息、能力边界一致。
- **追读力**：本章有明确 payoff，章末有下一章驱动力。
- **网文节奏**：每 500-800 字有行动、信息或关系变化。
- **文件落地**：正文 / 细纲已写回，不只留在对话。
- **返修边界**：收到 revision_brief 时只处理返修单列出的问题。

## Common Failure Signals

- 只写氛围和心理，没有让局面发生变化。
- 角色突然知道未读过的秘密，或能力越过既有等级。
- 细纲写成主题口号，没有场景顺序和章末钩子。
- 返修时重写整章，导致已通过部分产生新问题。

## Outputs / Write-Back

- `大纲/大纲.md`、`大纲/细纲_第NNN章.md`
- `正文/第NNN章_章名.md`
- `设定/世界观/*.md`、`设定/角色/角色名.md`、`设定/势力/势力名.md`（仅在创作必须时新建）
- `.project/status/system-state.json`：当前章节、活跃文件字段

不要写：他人维护的 `character-state.json` / `latest-plot.json` / `continuity-index.json`（交给连续性维护子任务）。

## Reference Map

使用 `skill_read({ action: "read", skillId, relativePath })` 读取。当前 skill 内文件的 `skillId` 为 `story-long-write`；跨 skill 文件必须显式切换 `skillId`。

| 场景 | skillId | relativePath | 读取时机 | 重点 |
|---|---|---|---|---|
| 开书 / 全书结构 | `story-long-write` | `references/outline-arrangement.md` | 新书立项、卷纲混乱、缺全书骨架 | 五步大纲、卷级排布、升级感、矛盾设计 |
| 黄金开头 | `story-long-write` | `references/opening-design.md` | 第 1 章、前 3 章、开篇重写 | 黄金一章、开头模板、开头问题诊断 |
| 人物与关系 | `story-long-write` | `references/character-design.md` | 主角 / 配角 / 反派设定不稳 | 动机链、关系映射、人物元素提取 |
| 题材框架 | `story-long-write` | `references/genre-frameworks-unified.md` | 需要匹配平台题材套路 | 长篇题材框架、事业线 / 感情线、赛道差异 |
| 题材开篇库 | `story-long-write` | `references/genre-opening-database.md` | 不知道某题材怎么开头 | 8 类题材开头模板与决策树 |
| 章首 / 章尾钩子 | `story-long-write` | `references/hook-techniques.md` | 追读弱、章末平、开头慢 | 章尾钩子 13 式、章首钩子 7 式 |
| 期待感和爽点 | `story-long-write` | `references/expectation-techniques.md` | 爽点铺垫不足或释放无力 | 期待感、信息差、爽点兑现 |
| 对话 | `story-long-write` | `references/dialogue-mastery.md` | 对话像说明书、人物声音雷同 | 潜台词、信息控制、对话模式 |
| 风格与场景 | `story-long-write` | `references/style-modules.md` | 文风不稳、打斗/智斗/装逼场景难写 | 镜头式写作、白描、爽点释放 |
| 情绪曲线 | `story-long-write` | `references/emotional-arc-design.md` | 情绪平、转折硬 | 情绪弧、拉扯、赛道情绪策略 |
| 反转 | `story-long-write` | `references/reversal-toolkit.md` | 需要误导、翻盘、章末反转 | 反转类型、时机、误导路径 |
| 卡文 / 调整 | `story-long-write` | `references/advanced-plot-techniques.md` | 情节推进卡住 | 小纲四步法、高潮逆推、双线结构 |
| 结构复盘 | `story-long-write` | `references/story-structure.md` | 卷内节奏失衡 | 八节点、循环写法、节奏控制 |
| 差异化 | `story-long-write` | `references/micro-innovation.md` | 题材同质化 | 微创新、差异化设计 |
| 自检 | `story-long-write` | `references/quality-checklist.md` | 写完正文、质检前 | 毒点、质量检查、常见问题 |
| 写作状态 | `story-long-write` | `references/writer-psychology.md` | 长篇推进焦虑、日更困难 | 码字习惯、职业规划、心理建设 |
| 去 AI 味 | `story-deslop` | `references/anti-ai-writing.md` | 出稿前预防或润色前 | 三遍法、禁用句式、改写范例 |
