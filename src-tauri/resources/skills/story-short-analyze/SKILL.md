---
name: story-short-analyze
description: |
  短篇网文拆文的执行手册。拆解爆款短篇的叙事结构、情绪曲线、反转技巧与钩子设计。
  Use when: 用户要拆短篇 / 分析对标短篇 / 研究反转 / 剖析情绪曲线，或临时拆文 subagent 处理短篇时调用。
  触发方式：/story-short-analyze、/短篇拆文、「帮我拆这个短篇」「分析这篇故事」
---

# story-short-analyze

把别人的爆款短篇拆透，提炼可复用的结构 / 反转 / 钩子模板。

## Use When

- 用户提到具体短篇并要求拆解。
- 短篇方向的对标拆文子任务。

## Inputs To Read

- 对标短篇正文（用 `web_search` + `web_fetch` 拿）。
- 本轮 `scan-*.md`（若来自市场扫描子任务）。
- 已有 `资料/拆文/` 拆解：避免重复；没有该目录时按需创建。

## Procedure

1. 拿全文，按 4-6 段拆「开头钩子 → 冲突建立 → 中段拉扯 → 反转 → 收束」。
2. 提取：开头 200 字技巧、对话密度、反转底层路径、结尾情绪落点。
3. 整理对标书档案、可借鉴模块、不要照抄部分。
4. 写入 `资料/拆文/{对标短篇}.md`。

## Breakdown Checklist

- **开头 200 字**：人物处境、关系裂缝、悬念、冲突压迫。
- **结构段落**：按情绪推进拆成 4-6 段，每段写清目标、阻力、变化。
- **反转机制**：误导信息、隐藏事实、证据回收、揭示时机。
- **人物关系**：谁压迫谁、谁误解谁、谁在结尾付出代价或获得补偿。
- **结尾 payoff**：复仇、释然、反杀、遗憾、治愈等情绪是否兑现。
- **可借鉴模块**：抽象成开头、冲突、反转、结尾模板，禁止照搬具体桥段。

## Output Requirements

- 拆解报告必须引用具体段落或场景。
- 每个反转都要说明铺垫点和揭示点。
- 给出「可借鉴」和「不要照抄」两组结论。

## Outputs / Write-Back

- `资料/拆文/{对标短篇}.md`

不要写：正文、设定、长篇拆解。

## Evidence Rules

- 拆解必须基于全文阅读；不要只看简介编节奏。
- 引用具体段落或场景。
- 区分「可借鉴」与「不要照抄」。

## Reference Map

使用 `skill({ action: "read", skillId, relativePath })` 读取。短篇拆文专属资料的 `skillId` 为 `story-short-analyze`；通用长篇资料复用时显式切换到 `story-long-write` 或 `story-short-write`。

| 场景 | skillId | relativePath | 读取时机 | 重点 |
|---|---|---|---|---|
| 拆解示例 | `story-short-analyze` | `references/deconstruction-examples.md` | 学习拆解颗粒度、输出示例 | 3 个完整案例 |
| 输出模板 | `story-short-analyze` | `references/output-templates.md` | 生成正式拆文报告 | 结构库、必填字段、报告格式 |
| 知乎盐言风格 | `story-short-analyze` | `references/zhihu-style.md` | 分析知乎盐言 / 情感故事 | 平台语气、结构、情绪钩子 |
| 题材公式 | `story-short-write` | `references/genre-writing-formulas.md` | 拆具体题材套路 | 21 大题材公式 |
| 题材框架 | `story-long-write` | `references/genre-frameworks-unified.md` | 长短篇题材共用结构 | 题材框架、长短篇视角 |
| 钩子 | `story-long-write` | `references/hook-techniques.md` | 深拆开头和结尾 | 钩子类型、悬念编排 |
| 人物 | `story-long-write` | `references/character-design.md` | 深拆角色关系和动机 | 动机链、关系映射 |
| 自检 | `story-long-write` | `references/quality-checklist.md` | 评估拆文质量或可写性 | 毒点、常见问题 |
| 市场数据 | `story-short-scan` | `references/real-market-data.md` | 需要结合平台风向 | 短篇平台差异、真实市场数据 |
