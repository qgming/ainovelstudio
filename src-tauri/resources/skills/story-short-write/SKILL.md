---
name: story-short-write
description: |
  短篇网文写作的执行手册。覆盖短篇立项、故事蓝图、整本成稿与按 revision_brief 返修。
  Use when: 用户要写短篇 / 写盐言故事 / 写番茄短篇 / 做短篇构思 / 设计反转，或短篇作者节点执行任务时调用。
  触发方式：/story-short-write、/写短篇、「帮我写一篇短篇」「写个盐言故事」
---

# story-short-write

把一个题材一次性写成可发布的独立短篇（1 万到 3 万字）。

## Use When

- 用户要写盐言 / 番茄 / 七猫等平台的短篇 / 微小说。
- 短篇集工厂的立项 / 蓝图 / 整本成稿节点。
- 用户要返修当前短篇（按 revision_brief）。

## Inputs To Read

- 用户主提示词（题材、平台、卖点、情绪基调、禁写约束）。
- 当前短篇项目目录的立项 / 蓝图 / 最小设定文件（已存在时）。
- `.project/status/factory-index.json`（若存在）：避开最近几篇已用过的题材 / 关系 / 反转 / 结局。
- 收到 revision_brief 时必读，并只针对当前项目修订。

## Procedure

### 立项

1. 锁定题材、关系结构、冲突引擎、情绪走向、反转方式、目标字数 / 章节、书名候选。
2. 写清与最近几篇的差异点。
3. 写入本轮项目目录的立项文件。

### 故事蓝图

1. 写清开篇钩子、主冲突、核心关系、推进节奏、中段反转、高潮回收、结局情绪点、章节拆分、最小设定。
2. 写入本轮项目目录的蓝图与最小设定文件；不做重型建档。

### 整本成稿

1. 完成 1 万到 3 万字独立完结。
2. 强开头 / 强冲突 / 强情绪拉扯 / 强反转 / 清晰 payoff / 可发布性。
3. 用 `word_count` 核对字数。

### 返修

1. 读 revision_brief，只动当前项目。
2. 用 `edit` 做最小修改。

## Execution Detail

### 立项文件必须回答

- 目标平台和读者是谁。
- 本篇的关系结构是什么：恋人 / 夫妻 / 亲情 / 职场 / 仇敌 / 陌生人。
- 冲突引擎是什么：误会、背叛、复仇、替身、重生、身份错位、资源争夺。
- 中段反转来自哪里：信息差、身份翻盘、证据揭露、情感选择、规则反噬。
- 结局情绪落点：爽、虐、释然、反杀、遗憾、治愈。

### 蓝图必须回答

- 开头 200 字钩子。
- 4-6 个大段落的情绪推进。
- 关键反转的铺垫点和揭示点。
- 主角每一段的处境变化。
- 结尾 payoff 兑现方式。

### 成稿必须守住

- 独立完结，不给下一篇埋长期主线。
- 每一段都服务冲突、反转或情绪 payoff。
- 人物设定够用即可，不做长篇式设定百科。
- 收到 revision_brief 时只返修当前短篇项目。

## Quality Gates

- **开头抓人**：前 200 字出现人物困境、关系裂缝或强事件。
- **反转可追溯**：反转前至少有 2 个可回看线索。
- **情绪兑现**：结尾回应开头承诺，不空喊主题。
- **篇幅达标**：1 万到 3 万字，用 `word_count` 复核。
- **避重**：与 factory-index 中最近几篇的题材 / 关系 / 反转 / 结局有明显差异。

## Outputs / Write-Back

- 当前短篇项目目录及其子文件（立项 / 蓝图 / 正文 / 最小设定）。
- `.project/status/project-state.json`：本项目的题材、字数、阶段。

不要写：工厂级 `factory-index.json`（由发布整理子任务登记）；不要回头改其他短篇项目。

## Reference Map

使用 `skill({ action: "read", skillId, relativePath })` 读取。短篇本地资料的 `skillId` 为 `story-short-write`；复用长篇通用资料时显式切到 `story-long-write`；去 AI 味显式切到 `story-deslop`。

| 场景 | skillId | relativePath | 读取时机 | 重点 |
|---|---|---|---|---|
| 开头设计 | `story-long-write` | `references/opening-design.md` | 开篇弱、钩子慢 | 黄金一章、开头模板 |
| 钩子 | `story-long-write` | `references/hook-techniques.md` | 开头 / 结尾缺追读力 | 章首钩子、章尾钩子、悬念编排 |
| 反转 | `story-long-write` | `references/reversal-toolkit.md` | 中段和结尾反转设计 | 反转类型、误导路径、揭示时机 |
| 情绪曲线 | `story-long-write` | `references/emotional-arc-design.md` | 情绪平、高潮弱 | 情绪弧、拉扯、赛道策略 |
| 题材框架 | `story-long-write` | `references/genre-frameworks-unified.md` | 选择题材套路 | 长短篇题材共用框架 |
| 短篇题材公式 | `story-short-write` | `references/genre-writing-formulas.md` | 盐言 / 女频 / 反转类短篇 | 21 类题材公式 |
| 人物 | `story-long-write` | `references/character-design.md` | 人物动机不稳 | 动机链、关系映射 |
| 对话 | `story-long-write` | `references/dialogue-mastery.md` | 对话解释感重 | 潜台词、信息控制 |
| 女频专项 | `story-short-write` | `references/female-audience-writing.md` | 女性向、追妻、虐恋、现实情感 | 女频情绪、关系张力 |
| 自检 | `story-long-write` | `references/quality-checklist.md` | 成稿后、终审前 | 毒点、质量检查 |
| 去 AI 味 | `story-deslop` | `references/anti-ai-writing.md` | 成稿后润色 | 三遍法、AI 味预防 |
