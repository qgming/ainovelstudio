# SKILL.md 标准骨架

把下面的占位符（`<...>`）替换成实际内容。删掉用不到的可选段，但 Use When / Procedure / Quality Gates / Reference Map 四件套尽量保留。

## 完整骨架

```markdown
---
name: <skill-id：kebab-case、纯英文数字连字符；网文类用 story- 前缀>
description: |
  <一句话定位：这个技能是什么、解决什么>。
  Use when: <场景1> / <场景2> / <场景3>，或<某子任务>时调用。
  触发方式：/<skill-id>、/<中文别名>、「<口语触发词1>」「<口语触发词2>」
---

# <skill-id>

<两三句话说清这个技能干什么、边界在哪、和相邻技能怎么配合。>

## Use When

- <什么情况下用它，逐条列，能判定。>
- <子任务场景。>

## Inputs To Read（写作 / 分析类技能保留，纯方法论技能可删）

- <接到任务必读的文件或上下文：README、相关记忆、上一章正文等。>

## Procedure

### <阶段A>

1. <具体动作或工具调用。>
2. <…>

### <阶段B>

1. <…>

## Quality Gates

- **<维度1>**：<可检查的标准。>
- **<维度2>**：<…>

## Common Failure Signals（可选）

- <这个技能最容易做错的信号。>

## Outputs / Write-Back（写作类技能保留）

- <写回哪些文件 / 产出什么结论。>
- 不写：<明确不该碰的东西。>

## Reference Map

使用 `skill_read({ action: "read", skillId, relativePath })` 读取。

| 场景 | skillId | relativePath | 读取时机 | 重点 |
|---|---|---|---|---|
| <何时需要这份资料> | `<本技能或被复用技能的 id>` | `references/<file>.md` | <触发时机> | <这份资料给什么> |
```

## 填写要点

- **name**：和目录名一致。只能英文小写、数字、连字符。中文 / 空格 / 斜杠会让 `skill_manage(create)` 失败。
- **description**：是模型决定「要不要读这个技能」的唯一依据，必须含 `Use when:` 与 `触发方式：`。详见 `description-writing.md`。
- **Procedure**：按真实执行顺序分阶段；每步对应一个动作或工具调用，不写「要注意…」这种没有动作的话。
- **Reference Map**：跨技能复用资料时，`skillId` 必须写被复用技能的 id，提醒读取时切换。
- **不抄内核**：通用任务循环、文件读取边界、事实源优先级在 `AGENTS.md` 已有，技能里别重复，只写差异化规则。
