# 状态文件说明

默认把状态文件放在工作区的 `.project/status/` 下；如果项目已经有稳定的状态目录，再沿用项目原规则。

## latest-plot.json

用途：

- 记录最新剧情游标
- 告诉其他技能“故事现在推进到哪了”

对应模板：

- `templates/latest-plot.template.json`

建议字段：

- `project_title`
- `current_arc`
- `current_volume`
- `current_chapter`
- `current_scene`
- `latest_update`
- `active_conflicts`
- `open_threads`
- `next_expected_push`

## character-state.json

用途：

- 记录角色当前状态，而不是长期人设

对应模板：

- `templates/character-state.template.json`

建议字段：

- `characters`
- 每个角色下维护：
  - `status`
  - `location`
  - `physical_state`
  - `mental_state`
  - `known_information`
  - `resources`
  - `relationships`
  - `active_goals`

## system-state.json

用途：

- 记录系统流、数值流、任务流等可量化状态

对应模板：

- `templates/system-state.template.json`

建议字段：

- `system_name`
- `rules_summary`
- `currencies`
- `stats`
- `skills`
- `quests`
- `cooldowns`
- `inventory`
- `faction_reputation`

## continuity-index.json

用途：

- 记录未回收伏笔、线索状态、关键知识分布和连续性风险

对应模板：

- `templates/continuity-index.template.json`

建议字段：

- `open_foreshadowing`
- `clues`
- `knowledge_distribution`
- `critical_items`
- `scene_risks`
- `last_checked_chapter`
