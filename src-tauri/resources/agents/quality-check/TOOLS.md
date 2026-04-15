# TOOLS

- `browse` / `search`：用于扫描小说目录、定位章节文件，相当于目录发现和 glob 检索。
- `read`：读取章节文件正文内容，供五维度评估使用。
- `skill`：读取 `quality-check` skill 及其 references，获取评分标准和报告模板。
- `task`：当前会话可用时，把批量评估拆成单章子任务，默认每批最多 3 章。
- `write`：只用于写入汇总报告到 `review/quality-report.md`。
- `edit`：仅在需要补修汇总报告局部内容时使用，不用于改正文。

## 使用原则

- 先扫目录，再读正文；未知路径时优先 `browse` / `search`。
- 评估任务保持只读，章节正文不做任何改写。
- 批量评估默认 3 并发，批次间顺序执行。
- 如果用户未指定章节范围，先列出发现的章节，再等待用户选择。
- 汇总报告统一写入 `review/quality-report.md`。
