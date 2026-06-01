---
name: story-continuity-audit
description: |
  长篇连载的连续性体检手册。系统排查设定冲突、伏笔失收、人设崩坏、时间线错乱、能力越级等连载顽疾，产出问题清单与修订建议。
  Use when: 用户要查连续性 / 查伏笔 / 查人设有没有崩 / 查设定有没有矛盾 / 怀疑前后对不上 / 连载推进前后核对，或写新章前要确认不违背 canon、阶段性回顾时调用。
  触发方式：/story-continuity-audit、/连续性检查、/查伏笔、「前后对得上吗」「人设崩了没」「有没有矛盾」「查一下连续性」
metadata:
  displayName: 连续性审稿
---

# story-continuity-audit

给长篇连载做体检：找出设定冲突、伏笔失收、人设崩坏、时间线错乱、能力越级，给出问题清单和最小修订建议。

本技能管「找问题」；找到后怎么改正文是 `story-long-write`（返修）和 `story-prose-craft` 的事；本技能只产出诊断和建议，默认不直接大改正文。

## Use When

- 写新章前，要确认不违背已有 canon（人物已知信息、能力边界、地点、时间）。
- 连载推进到阶段节点，做一次回顾性体检。
- 用户怀疑前后对不上、人设崩了、伏笔忘了收。
- 返修前先定位全部问题，再交给写作技能改。

## Inputs To Read

- `.project/memory/` 的伏笔台账（`type: foreshadow`）、人物记忆（`type: character`）、设定 / 时间线（`type: setting` / `type: timeline`）。
- 被查范围的正文：用 `workspace_read` 读相关章节。
- `.project/README.md` 的 canon 约定与世界观规则。

## Procedure

1. **定范围**：明确体检哪些章（全书 / 某卷 / 最近 N 章 / 某条线）。范围大时分段查。
2. **取基线**：读伏笔台账、人物记忆、设定 / 时间线记忆，作为对照 canon。
3. **精确定位**：用 `workspace_grep` 查人名 / 地名 / 术语 / 能力名的**全部出现**，比对前后是否一致（错别字、改名、设定漂移）；用 `workspace_search` 语义召回某条线 / 某伏笔的相关章节。
4. **逐项核对**：按 `references/continuity-checklist.md` 的五类逐条查。
5. **出清单**：每个问题写清：类型、位置（章节 + 锚点）、冲突的两处事实、严重度、最小修订建议。
6. **同步台账**：发现台账漏登 / 状态过时的伏笔，提示更新 `type: foreshadow` 记忆（推进剧情的回收 / 新埋）。

## 五类体检维度

详见 `references/continuity-checklist.md`：

1. **设定冲突**：同一设定前后描述矛盾（能力规则、地理、组织、物品功能）。
2. **伏笔失收**：埋了没回收、回收了没铺垫、回收得突兀。
3. **人设崩坏**：人物性格 / 动机 / 说话方式前后不一致，或行为违背已立人设。
4. **时间线错乱**：事件先后、季节 / 年龄 / 时长对不上。
5. **能力越级**：主角 / 角色能力突然越过既定边界，或敌强弱失序。

## Quality Gates

- **有证据**：每个问题都引用具体章节 + 原文锚点，不凭印象说「好像不对」。
- **指明冲突双方**：写清「A 处说 X、B 处说 Y」，而非只说「有矛盾」。
- **给最小修订**：建议改动尽量局部，优先改晚出现的那处或台账，不要求重写整章。
- **分严重度**：区分「硬伤（读者会出戏）」与「小瑕疵（可缓改）」。
- **台账闭环**：体检后伏笔台账状态与正文一致。

## Common Failure Signals

- 只说「感觉有点乱」，没有定位到具体章节和冲突事实。
- 把作者有意的反转 / 误导当成 bug。
- 建议大改 / 重写，制造新的连续性问题。
- 查了正文但没核对 / 更新伏笔台账。

## Outputs / Write-Back

- 体检报告：问题清单（类型 / 位置 / 冲突双方 / 严重度 / 修订建议）。可暂存对话或写 `资料/体检-*.md`。
- 提示更新 `.project/memory/` 的伏笔台账 / 人物 / 设定记忆。
- 默认不直接改正文——除非用户要求顺手修明确的小硬伤（按最小改动）。

## Reference Map

使用 `skill_read({ action: "read", skillId, relativePath })` 读取。

| 场景 | skillId | relativePath | 读取时机 | 重点 |
|---|---|---|---|---|
| 五类体检清单 | `story-continuity-audit` | `references/continuity-checklist.md` | 逐项核对时 | 设定 / 伏笔 / 人设 / 时间线 / 能力的检查点 |
| 人物动机核对 | `story-long-write` | `references/character-design.md` | 查人设崩坏时 | 动机链、关系映射 |
| 自检毒点 | `story-long-write` | `references/quality-checklist.md` | 综合质检 | 毒点、常见问题 |
| 返修落地 | `story-long-write` | `SKILL.md` | 问题确认后要改正文 | 返修阶段最小修改 |
