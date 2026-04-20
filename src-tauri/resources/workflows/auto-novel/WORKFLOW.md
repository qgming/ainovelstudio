# 全自动写小说

这是一个面向长篇连载创作的内置工作流模板，已经切换到新的内置编辑链：`chief-editor`、`outline-editor`、`chapter-editor`、`serial-writer`、`review-editor`、`polish-editor`、`lore-editor`。

## 适用场景

- 已经有基础工作区，希望持续推进长篇连载
- 希望把调度、结构同步、拆章、落稿、审稿、润稿和设定回写串成稳定流水线
- 希望每轮循环都围绕“当前应推进的章节”自动工作
- 希望正文推进后，canon 和动态状态也能同步维护

## 默认流程

1. `chief-editor` 先判断本轮该推进哪一章、先修什么风险
2. `outline-editor` 同步本轮相关的大纲、角色弧线和伏笔计划
3. `chapter-editor` 为当前目标章节创建或更新单章规划
4. `serial-writer` 完成正文落稿或按返修要求重写当前章节
5. `review-editor` 在判断节点中完成审稿，并通过 `workflow_decision` 提交结构化结论
6. 审稿未通过时，工作流直接回到 `serial-writer` 返修当前章节
7. 审稿通过后，`polish-editor` 做最终润稿
8. `lore-editor` 把本章新增事实回写到设定文件与状态文件
9. 结束节点根据最大轮次决定是否回到开始节点继续下一轮

## 运行语义

- 工作区文件是长期事实源，所有节点都必须先读文件再行动
- 每一轮默认围绕当前最该推进的章节工作
- 结构更新发生在拆章之前，正文落稿发生在审稿之前，设定回写发生在润稿之后
- 判断步骤通过 `workflow_decision` 工具传递 `pass`、`issues`、`revision_brief`
- 审稿失败后只返修当前章节与直接相关文件
- 若出现新人物、新地点、新组织、新道具、新线索或新的状态变化，应优先更新设定与状态文件

## 绑定建议

- 先绑定一本已经初始化好的书籍工作区
- 工作区中最好已有基础大纲、核心设定和正文目录
- 首次运行前建议确认新的内置代理资源已经初始化完成，尤其是 `chief-editor`、`chapter-editor`、`serial-writer`、`review-editor`

## 节点侧重点

- `editorial-dispatch` 节点负责本轮调度与优先级判断
- `outline-sync` 节点负责同步结构资产，不直接代写正文
- `chapter-plan` 节点负责单章目标、节拍和章末钩子
- `draft-chapter` 节点负责正文成稿与当前章节返修
- `review-chapter` 节点只做判断与返修意见整理
- `polish-chapter` 节点负责语言层最终整理
- `update-lore` 节点负责 canon 与 `story-state` 一类状态文件的回写

## 其他说明

- 所有节点都不要求严格输出 JSON
- 工作流本身不自动绑定书籍，进入详情页后由用户手动绑定
- 左侧基础区可直接设置最大循环次数，并支持切换为无限
- 运行历史和步骤复盘保存在数据库中，不写回模板文件
