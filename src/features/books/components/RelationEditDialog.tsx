import { useId, useMemo, useState } from "react";
import { Button } from "@shared/ui/button";
import { getSurfaceActionClassName } from "@shared/ui/action-button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";
import { Textarea } from "@shared/ui/textarea";
import { DialogShell } from "@shared/components/dialogs/DialogShell";
import { isTextEditableFile } from "@features/books/lib/paths";
import { flattenTreeFiles } from "@features/books/lib/tree";
import type { TreeNode, WorkspaceRelation } from "@features/books/types";

type RelationEditMode =
  | {
      kind: "create";
      sourceEntryPath: string; // 发起方文件(锁定为 A 侧)
    }
  | {
      kind: "edit";
      relation: WorkspaceRelation;
    };

type RelationEditDialogProps = {
  busy?: boolean;
  errorMessage?: string | null;
  existingRelations?: WorkspaceRelation[]; // 用于"create"时排除已关联的对端文件
  mode: RelationEditMode;
  onCancel: () => void;
  onSubmit: (payload: {
    note: string | null; // null = 清空;字符串 = 设为该值
    relationship: string;
    targetEntryPath: string; // 编辑时忽略,后端不允许换对端
  }) => Promise<void>;
  rootNode: TreeNode | null;
  rootPath: string;
};

// 提取对端路径(给"create"时排除已关联的目标用)。
function getOtherEntryPath(relation: WorkspaceRelation, selfPath: string) {
  return relation.entryAPath === selfPath ? relation.entryBPath : relation.entryAPath;
}

// 文件关联编辑弹窗:新建和编辑共用同一表单。
export function RelationEditDialog({
  busy = false,
  errorMessage,
  existingRelations = [],
  mode,
  onCancel,
  onSubmit,
  rootNode,
  rootPath,
}: RelationEditDialogProps) {
  const targetId = useId();
  const relationshipId = useId();
  const noteId = useId();

  const initialRelationship = mode.kind === "edit" ? mode.relation.relationship : "";
  const initialNote = mode.kind === "edit" ? mode.relation.note ?? "" : "";
  const initialTarget = mode.kind === "edit"
    ? mode.relation.entryAPath === rootPath
      ? mode.relation.entryBPath
      : mode.relation.entryAPath
    : "";

  const [relationship, setRelationship] = useState(initialRelationship);
  const [note, setNote] = useState(initialNote);
  const [targetEntryPath, setTargetEntryPath] = useState(initialTarget);

  // 候选文件列表:全部可编辑文本文件,排除发起方自身以及已经关联过的对端。
  const candidateFiles = useMemo(() => {
    if (mode.kind === "edit") {
      return [] as TreeNode[];
    }
    const all = flattenTreeFiles(rootNode).filter((node) =>
      isTextEditableFile(node.name),
    );
    const sourcePath = mode.sourceEntryPath;
    const linkedPaths = new Set(
      existingRelations.map((relation) => getOtherEntryPath(relation, sourcePath)),
    );
    return all.filter(
      (node) => node.path !== sourcePath && !linkedPaths.has(node.path),
    );
  }, [existingRelations, mode, rootNode]);

  const title = mode.kind === "create" ? "新建关联" : "编辑关联";
  const confirmLabel = mode.kind === "create" ? "创建关联" : "保存";
  const canSubmit = mode.kind === "edit"
    ? relationship.trim().length > 0
    : Boolean(targetEntryPath) && relationship.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    // 备注为空时传 null,代表"清空"(编辑模式)或"未填写"(新建模式后端忽略)。
    const trimmedNote = note.trim();
    await onSubmit({
      note: trimmedNote.length > 0 ? trimmedNote : null,
      relationship: relationship.trim(),
      targetEntryPath,
    });
  }

  return (
    <DialogShell title={title} onClose={onCancel}>
      <div className="flex flex-1 flex-col gap-5">
        {mode.kind === "create" ? (
          <div className="space-y-2">
            <Label htmlFor={targetId} className="text-xs text-muted-foreground">
              目标文件
            </Label>
            <select
              id={targetId}
              autoFocus
              value={targetEntryPath}
              onChange={(event) => setTargetEntryPath(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <option value="">请选择一个文件...</option>
              {candidateFiles.map((node) => (
                <option key={node.path} value={node.path}>
                  {node.path.startsWith(`${rootPath}/`)
                    ? node.path.slice(rootPath.length + 1)
                    : node.path}
                </option>
              ))}
            </select>
            {candidateFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                没有可关联的文件 — 当前书籍里没有其它文本文件,或全部已关联。
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">目标文件</Label>
            <p className="truncate text-sm text-foreground">
              {initialTarget.startsWith(`${rootPath}/`)
                ? initialTarget.slice(rootPath.length + 1)
                : initialTarget}
            </p>
            <p className="text-xs text-muted-foreground">
              编辑模式不支持修改目标文件,如需更换请先删除再新建关联。
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={relationshipId} className="text-xs text-muted-foreground">
            关系标签
          </Label>
          <Input
            id={relationshipId}
            autoFocus={mode.kind === "edit"}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
            placeholder="如:出场人物 / 涉及势力 / 引用设定 / 前置剧情"
            className="h-10"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={noteId} className="text-xs text-muted-foreground">
            备注(可选)
          </Label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="一行简短说明,例如:本章主角 / 后文将揭示的伏笔"
            className="min-h-16"
          />
        </div>

        {errorMessage ? (
          <p className="text-xs text-destructive">{errorMessage}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            className={getSurfaceActionClassName({
              className: "min-w-0 sm:flex-none",
              tone: "default",
            })}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !canSubmit}
            onClick={() => void handleSubmit()}
            className={getSurfaceActionClassName({
              className: "min-w-0 sm:flex-none",
              tone: "primary",
            })}
          >
            {busy ? "处理中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
