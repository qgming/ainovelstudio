---
name: skill-creator
description: |
  创建与改进本地技能的方法论手册。把反复用到的写作套路、流程、检查清单或风格，沉淀成结构规范、触发精准的可复用 skill。
  Use when: 用户要新建技能 / 改进现有技能 / 把一套写法或流程固化下来 / 说「做成一个技能」「把这套套路存下来」「记住这个流程」，或被 story-author-style 调用以固化炼化出的作者风格时。
  触发方式：/skill-creator、「做个技能」「把这套套路存成技能」「优化这个技能的触发」
metadata:
  displayName: 技能制作
---

# skill-creator

把一套可复用的写法、流程或风格，做成一个结构清晰、触发准确、按需加载的本地技能。

本手册管「怎么造技能 / 改技能」；造出来的写作类技能，其内部规则仍按 `story-prose-craft`、`story-deslop` 等既有技能的风格写。

## Use When

- 用户要把一套反复使用的写法、流程、质检清单固化成技能。
- 用户要改进现有技能的结构、流程或触发描述（触发不准、流程冗长、references 散乱）。
- 被 `story-author-style` 调用：把炼化出的某个作者风格基因固化为一个独立技能。

## 核心流程（四步）

### 1. 澄清意图

下手前先答清三件事，缺信息用 `ask_user`，不要凭空编：

- **场景**：这个技能解决什么？是写、改、查、还是调研？
- **触发**：用户说什么话、用什么命令时该启用它？
- **产出**：调用后产出什么（成稿 / 报告 / 检查结论 / 写回哪些文件）？

### 2. 起骨架

用 `skill_manage(action:"create", name, description)` 建技能记录，系统会按模板生成初始 `SKILL.md`：

- `name`：kebab-case、纯英文数字与连字符（会做文件名安全校验，中文 / 空格 / 斜杠会失败）。网文类技能沿用 `story-` 前缀。
- `description`：≤1024 字符，**必须**含 `Use when:` 与 `触发方式：` 两段（写法见 `references/description-writing.md`）。

### 3. 写正文

用 `skill_manage(action:"write", skillId, relativePath:"SKILL.md", content)` 覆写正文，套用 `references/skill-template.md` 的四件套骨架。

### 4. 配资料（按需）

长方法论、模板、案例拆进 `references/`：先 `skill_manage(action:"create_reference", skillId, name)` 建文件，再 `action:"write"` 写内容。SKILL.md 本体只留 Reference Map 索引，不把长内容塞进正文。

## 写好一个 SKILL.md 的硬规则

- **短而硬**：每条规则要么是「必须 / 禁止」，要么是「分支判断」，不写方法论散文。
- **四件套齐全**：Use When、Procedure、Quality Gates、Reference Map 是底线；写作类技能再补 Inputs To Read、Outputs / Write-Back。
- **按需加载**：references 是「需要时才读」的资料，不预占上下文；SKILL.md 只放索引。
- **不重复内核**：通用任务循环、事实源优先级、工具调用边界已在 Agent OS 内核（`AGENTS.md`）写过，技能里不重复，只写本技能的差异化契约。
- **沿用项目格式**：对标 `story-long-write` 的章节结构与措辞密度，不另发明体系。

## 改进现有技能

- 先 `skill_read(action:"read", skillId, relativePath:"SKILL.md")` 读现状，再做最小改动，不整体重写。
- 触发不准（该启用没启用 / 误启用）时，优先改 `description` 的 `Use when:` 与触发词，而非动正文。
- references 失效或重复时合并、删除；跨技能复用的 references 在 Reference Map 里写清要切换的 `skillId`。

## Quality Gates

- **触发可判定**：读 description 就能判断「这个任务该不该用本技能」，无歧义。
- **流程可执行**：Procedure 每一步都对应具体动作或工具调用，不是口号。
- **产出明确**：写清写回哪些文件 / 产出什么结论。
- **无内核重复**：没有把 AGENTS.md 的通用规则再抄一遍。
- **加载克制**：SKILL.md 本体精简，长资料在 references。

## Common Failure Signals

- description 没有 `Use when:`，模型不知道何时该读它。
- SKILL.md 写成长篇方法论，references 形同虚设。
- 新技能重复了内核或其他技能已有的规则。
- name 用了中文 / 空格导致 create 失败，却没换成 kebab-case 重试。

## Outputs / Write-Back

- 新建：`<skill-id>/SKILL.md` 及按需的 `<skill-id>/references/*.md`。
- 改进：被修改的技能文件（最小改动）。
- 不写：工作区正文、设定、项目记忆（造技能不等于写书内容）。

## Reference Map

使用 `skill_read({ action: "read", skillId: "skill-creator", relativePath })` 读取。

| 场景 | relativePath | 读取时机 | 重点 |
|---|---|---|---|
| SKILL.md 标准骨架 | `references/skill-template.md` | 写新技能正文前 | 四件套结构模板、占位符填法 |
| 触发描述写法 | `references/description-writing.md` | description 触发不准、新建技能 | Use when + 触发方式 公式、正反例 |
