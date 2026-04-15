# TOOLS

- `browse` / `search`：用于扫描小说目录、定位章节文件，并按章节号找到前三章。
- `read`：读取章节正文内容，供黄金三章逐项检查使用。
- `skill`：读取 `opening-check` skill 及其 references，获取黄金三章法则、常见问题和报告模板。
- `task`：当前会话可用时，把前三章检查拆成独立子任务，默认一批最多 3 章。
- `write`：只用于写入汇总报告到 `review/opening-report.md`。
- `edit`：仅在需要补修汇总报告局部内容时使用，不用于改正文。

## 使用原则

- 先扫目录，再读正文；未知路径时优先 `browse` / `search`。
- 检查任务保持只读，章节正文不做任何改写。
- 未指定章节时，默认检查前三章。
- 批量检查默认 3 并发，前三章通常一批完成。
- 汇总报告统一写入 `review/opening-report.md`。
