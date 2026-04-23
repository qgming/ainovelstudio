---
name: story-state
description: 在小说项目存在动态状态时优先使用。它负责在项目工作区的 `.project/status/` 中创建、读取、更新和校验 `latest-plot.json`、`character-state.json`、`system-state.json`、`continuity-index.json` 一类结构化状态文件，把正文新增信息同步为可程序化维护的动态真值层，供 `story-writer`、`continuity-check`、`story-bible` 和 `outline-manager` 读取。
---

# story-state

## 目标

- 为小说工作区提供独立于 Markdown canon 的动态状态层。
- 把最新剧情游标、角色即时状态、系统参数和未回收线索维护成稳定 JSON。
- 在更新状态时优先遵循本 skill 内置的 JSON 模板。
- 输出可直接供其他 skills 和工具读取的结构化状态文件。

## 优先使用时机

以下情况优先调用本 skill：

- 项目存在系统流、数值流、任务流、阵营声望、资源变化等动态状态
- 每写完一章，需要同步“最新推进到哪里了”
- 用户希望把角色当前状态从长期设定中拆出来单独维护
- 用户需要给工具、脚本或校验流程提供稳定 JSON 输入
- 用户要检查某些状态是否在多章推进中漂移

如果任务重点是长期 canon，优先交给 `story-bible`。如果任务重点是大纲结构，优先交给 `outline-manager`。

## 核心原则

- JSON 只维护动态真值，不复述长篇正文。
- 长期事实归 `story-bible`，结构推进归 `outline-manager`，即时状态归本 skill。
- 更新状态前先读取对应模板。
- 新状态必须能追溯到正文、大纲或设定证据。
- 字段名保持稳定，避免同义字段并存。

## Humanizer 核心 10 条

涉及自然语言输出时，默认遵守以下 10 条：

- 用简单词，直接说话，少解释。
- 只用基础标点 `。，！？“”`。
- 少用复杂符号和花式格式，避免分号、冒号、破折号、表情和过多加粗。
- 结构保持自然，少用机械排比、三连句和标题后空话。
- 少写空泛大词和强行升华，例如“意义”“格局”“关键时刻”。
- 少写宣传腔和夸张修饰，用具体事实替代空泛形容。
- 少用模糊归因，观点、判断和信息尽量落到明确主体。
- 多用主动表达，直接写“是”“有”“谁做了什么”。
- 删除套话和聊天痕迹，例如“希望这对你有帮助”“让我们来看看”。
- 小说场景优先演出来，用动作、对白、细节写情绪，少概述、少贴标签、少旁白解释。

## 强制读取规则

使用本 skill 时，必须先读取：

- `references/state-files.md`
- `references/update-rules.md`

初始化或补齐具体状态文件前，按需读取对应模板：

- `templates/latest-plot.template.json`
- `templates/character-state.template.json`
- `templates/system-state.template.json`
- `templates/continuity-index.template.json`

如果这次更新来自正文或章节规划，再补读：

- 相关前文章节或新章节正文
- `chapter-planner` 结果
- `story-bible` 中相关 canon
- `outline-manager` 中相关结构

## 工作流程

1. 阅读用户需求，判断当前属于初始化状态层、章节后同步、系统参数更新、角色状态刷新或线索索引维护。
2. 在工作区中寻找已有 `.project/status/`、`state/` 或其他 JSON 状态目录；如果没有，优先创建 `.project/status/` 作为最小必要结构。
3. 读取对应模板，明确字段结构、对象层级和命名方式。
4. 从正文、大纲、设定和章节规划中提取可以落为动态状态的事实。
5. 如果项目还没有状态文件，先复制模板再填入当前真值；如果已有文件，按模板补齐和整理结构。
6. 如果状态变化会影响多个文件，同步更新：
   - 最新剧情游标
   - 角色当前状态
   - 系统 / 数值参数
   - 未回收线索索引
7. 更新后检查 JSON 是否与模板结构和相关文本证据一致。
8. 输出更新后的状态文件路径、影响范围和必要的同步建议。

## 默认维护文件

优先维护以下 JSON：

- `latest-plot.json`：最新剧情游标、当前卷 / 章 / 场景位置、当前冲突和未完成任务
- `character-state.json`：角色即时状态、关系变化、已知信息、伤势、资源、立场和阶段目标
- `system-state.json`：系统参数、数值、任务、技能、资源、阵营声望、冷却和限制
- `continuity-index.json`：未回收伏笔、线索状态、关键物品位置、知识分布和风险提醒

## 工作区存放规则

- 优先复用项目已有的状态目录和命名规则
- 如果项目还没有状态目录，默认创建 `.project/status/`
- 模板默认放在本 skill 的 `templates/`
- 状态文件优先保持单一职责，不做“大一统 JSON”

## 输出要求

- 表达直接，方便继续执行。
- 只更新有证据支撑的状态。
- 清楚区分已确认状态、待确认状态和从文本推断出的临时状态。
- JSON 内容要稳定、简洁、可程序化处理。
- 上下文不足时明确说明假设。

## 与其他 skills 的衔接

- `story-bible` 提供长期事实背景
- `outline-manager` 提供结构推进背景
- `chapter-planner` 提供单章目标与场景推进
- `story-writer` 写完正文后，适合回到本 skill 同步状态
- `continuity-check` 检查时可读取本 skill 维护的 JSON

## 参考资料

- `references/state-files.md`
- `references/update-rules.md`
- `templates/latest-plot.template.json`
- `templates/character-state.template.json`
- `templates/system-state.template.json`
- `templates/continuity-index.template.json`

## 备注

- 本 skill 负责动态状态，不负责长期 canon 建档。
- JSON 模板是状态层的结构约定，优先按模板保持兼容。
