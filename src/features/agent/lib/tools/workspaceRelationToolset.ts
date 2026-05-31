// 文件关联工具集:供 AI 创建/编辑/删除/查询工作区文件之间的无向关联。
//
// 与 workspaceStructureToolset / workspaceTextToolset 分开放,因为关联是结构化数据(表),
// 不是文本内容,语义边界清晰。每个工具内部直接调 bookWorkspaceApi 的封装,无需重新实现 invoke。

import {
  createEntryRelation,
  deleteEntryRelation,
  listEntryRelations,
  updateEntryRelation,
} from "@features/books/api/bookWorkspaceApi";
import type { WorkspaceRelation } from "@features/books/types";
import type { AgentTool } from "../runtime";
import {
  ensureString,
  normalizeRelativePath,
  ok,
  toDisplayPath,
  type WorkspaceToolContext,
} from "./shared";

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
    workspace_relation_list: {
      description: "列出一个文件的全部关联及其关系标签",
      execute: async (input) => {
        const path = ensureString(input.path, "path");
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
      },
    },
    workspace_relation_create: {
      description: "在两个文件之间创建一条关联(无向)。同一对文件可以有多条不同 relationship 标签的关联。",
      execute: async (input) => {
        const pathA = ensureString(input.pathA, "pathA");
        const pathB = ensureString(input.pathB, "pathB");
        const relationship = ensureString(input.relationship, "relationship");
        const note = typeof input.note === "string" ? input.note : null;
        const created = await createEntryRelation(bookId, pathA, pathB, relationship, note);
        if (onWorkspaceMutated) {
          await onWorkspaceMutated();
        }
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
      },
    },
    workspace_relation_update: {
      description: "修改一条已有关联的关系标签或备注。关联 ID 通过 workspace_relation_list 取得。",
      execute: async (input) => {
        const relationId = ensureString(input.relationId, "relationId");
        const changes: { note?: string | null; relationship?: string } = {};
        if (typeof input.relationship === "string") {
          changes.relationship = input.relationship;
        }
        // note 三态:
        //   缺省/undefined → 不修改
        //   null           → 清空
        //   字符串         → 改为该值
        if (input.note === null) {
          changes.note = null;
        } else if (typeof input.note === "string") {
          changes.note = input.note;
        }
        const updated = await updateEntryRelation(bookId, relationId, changes);
        if (onWorkspaceMutated) {
          await onWorkspaceMutated();
        }
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
      },
    },
    workspace_relation_delete: {
      description: "删除一条关联。这只是移除边,不会影响文件本身。",
      execute: async (input) => {
        const relationId = ensureString(input.relationId, "relationId");
        await deleteEntryRelation(bookId, relationId);
        if (onWorkspaceMutated) {
          await onWorkspaceMutated();
        }
        return ok(`已删除关联 ${relationId}。`);
      },
    },
  };
}
