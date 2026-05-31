// 文件关联工具:供 AI 创建/编辑/删除/查询工作区文件之间的无向关联。
//
// 单工具 + action 分流(list/create/update/delete),贴近 pi「同类操作收敛」理念。
// 关联是结构化数据(表),内部直接调 bookWorkspaceApi 的 4 个封装,无需重新实现 invoke。

import {
  createEntryRelation,
  deleteEntryRelation,
  listEntryRelations,
  updateEntryRelation,
} from "@features/books/api/bookWorkspaceApi";
import type { WorkspaceRelation } from "@features/books/types";
import type { AgentTool } from "../session/runtime";
import {
  ensureString,
  normalizeRelativePath,
  ok,
  toDisplayPath,
  type WorkspaceToolContext,
} from "./shared";

type RelationAction = "list" | "create" | "update" | "delete";

function normalizeRelationAction(value: unknown): RelationAction {
  return value === "create" || value === "update" || value === "delete"
    ? value
    : "list";
}

// 把 RelationDto(后端返回 relative path)转成对 AI 更友好的形态:
// 对端路径用相对路径展示,与其它工作区工具保持一致(避免每条关联都带 "books/书名/" 前缀)。
// displayPath 仅用于路径渲染(books/<书名>),与解析用 bookId 区分。
function toRelationView(displayPath: string, relation: WorkspaceRelation, selfRelative: string) {
  const isSelfA = relation.entryAPath === selfRelative;
  const otherRelative = isSelfA ? relation.entryBPath : relation.entryAPath;
  return {
    id: relation.id,
    note: relation.note,
    otherPath: toDisplayPath(displayPath, otherRelative),
    relationship: relation.relationship,
  };
}

export function createWorkspaceRelationTools({
  onWorkspaceMutated,
  bookId,
  displayPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    workspace_relation: {
      description:
        "管理工作区文件之间的无向关联(多对多)。action=list 列出某文件的全部关联;create 在两个文件间建关联;update 改关系标签或备注;delete 删一条关联边。",
      execute: async (input) => {
        const action = normalizeRelationAction(input.action);

        if (action === "list") {
          const path = ensureString(input.path, "workspace_relation.path");
          const relativePath = normalizeRelativePath(displayPath, path);
          const relations = await listEntryRelations(bookId, path);
          const views = relations.map((relation) => toRelationView(displayPath, relation, relativePath));
          const nodeDisplayPath = toDisplayPath(displayPath, relativePath);
          return ok(
            views.length === 0
              ? `${nodeDisplayPath} 还没有任何关联。`
              : `${nodeDisplayPath} 共有 ${views.length} 条关联。`,
            { path: nodeDisplayPath, relations: views },
          );
        }

        if (action === "create") {
          const pathA = ensureString(input.pathA, "workspace_relation.pathA");
          const pathB = ensureString(input.pathB, "workspace_relation.pathB");
          const relationship = ensureString(input.relationship, "workspace_relation.relationship");
          const note = typeof input.note === "string" ? input.note : null;
          const created = await createEntryRelation(bookId, pathA, pathB, relationship, note);
          await onWorkspaceMutated?.();
          return ok(
            `已创建关联:${toDisplayPath(displayPath, created.entryAPath)} ↔ ${toDisplayPath(
              displayPath,
              created.entryBPath,
            )} [${created.relationship}]`,
            {
              id: created.id,
              note: created.note,
              pathA: toDisplayPath(displayPath, created.entryAPath),
              pathB: toDisplayPath(displayPath, created.entryBPath),
              relationship: created.relationship,
            },
          );
        }

        if (action === "update") {
          const relationId = ensureString(input.relationId, "workspace_relation.relationId");
          const changes: { note?: string | null; relationship?: string } = {};
          if (typeof input.relationship === "string") {
            changes.relationship = input.relationship;
          }
          // note 三态:缺省/undefined → 不修改;null → 清空;字符串 → 改为该值
          if (input.note === null) {
            changes.note = null;
          } else if (typeof input.note === "string") {
            changes.note = input.note;
          }
          const updated = await updateEntryRelation(bookId, relationId, changes);
          await onWorkspaceMutated?.();
          return ok(
            `已更新关联 ${relationId}:[${updated.relationship}]`,
            {
              id: updated.id,
              note: updated.note,
              pathA: toDisplayPath(displayPath, updated.entryAPath),
              pathB: toDisplayPath(displayPath, updated.entryBPath),
              relationship: updated.relationship,
            },
          );
        }

        const relationId = ensureString(input.relationId, "workspace_relation.relationId");
        await deleteEntryRelation(bookId, relationId);
        await onWorkspaceMutated?.();
        return ok(`已删除关联 ${relationId}。`);
      },
    },
  };
}
