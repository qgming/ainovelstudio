import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@shared/ui/dropdown-menu";
import { cn } from "@shared/utils";
import type { WorkspaceRelation } from "@features/books/types";

type RelationPopoverProps = {
  // 触发元素:由调用方提供(通常是 BookTreeItem 中带角标的链接按钮)。
  children: React.ReactNode;
  // 当前 entry 的 display path,用于判断关联中的对端是哪一侧。
  entryPath: string;
  onAddRelation: () => void;
  onDeleteRelation: (relation: WorkspaceRelation) => void;
  onEditRelation: (relation: WorkspaceRelation) => void;
  onOpenChange?: (open: boolean) => void;
  onSelectEntry: (entryPath: string) => void;
  open?: boolean;
  relations: WorkspaceRelation[];
  rootPath: string;
};

function getOtherEntryPath(relation: WorkspaceRelation, selfPath: string) {
  return relation.entryAPath === selfPath ? relation.entryBPath : relation.entryAPath;
}

function getRelativeDisplayPath(entryPath: string, rootPath: string) {
  return entryPath.startsWith(`${rootPath}/`)
    ? entryPath.slice(rootPath.length + 1)
    : entryPath;
}

function getBaseName(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

// 关联面板:点击文件树行上的关联图标后弹出,展示该文件的所有关联,并支持新增/编辑/删除/跳转。
// 使用 DropdownMenu 作为浮层载体(项目无独立 Popover 组件),但内部渲染自定义内容而非菜单项。
export function RelationPopover({
  children,
  entryPath,
  onAddRelation,
  onDeleteRelation,
  onEditRelation,
  onOpenChange,
  onSelectEntry,
  open,
  relations,
  rootPath,
}: RelationPopoverProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // 重置默认菜单内边距,让自定义列表能贴边渲染。
        className="w-80 p-0"
        // 阻止 DropdownMenu 内置的键盘焦点行为吃掉点击事件。
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border bg-panel-subtle px-3 py-2">
          <span className="truncate text-xs font-medium text-foreground">
            {getBaseName(entryPath)} 的关联
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="新增关联"
            title="新增关联 — 在这个文件和另一个文件之间创建关联"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddRelation();
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {relations.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            还没有关联,点击右上角加号创建第一个。
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {relations.map((relation) => {
              const otherPath = getOtherEntryPath(relation, entryPath);
              const otherDisplay = getRelativeDisplayPath(otherPath, rootPath);
              return (
                <li
                  key={relation.id}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 transition",
                    "hover:bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectEntry(otherPath)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {getBaseName(otherPath)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {otherDisplay}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded-md bg-panel-subtle px-1.5 py-0.5 text-primary">
                          {relation.relationship || "未标注"}
                        </span>
                        {relation.note ? (
                          <span className="truncate text-muted-foreground">
                            {relation.note}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="编辑关联"
                      title="编辑关联 — 修改关系标签或备注"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onEditRelation(relation);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="删除关联"
                      title="删除关联 — 移除这条关联(不影响文件本身)"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onDeleteRelation(relation);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
