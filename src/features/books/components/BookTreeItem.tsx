import {
  AtSign,
  ChevronRight,
  Ellipsis,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/ui/dropdown-menu";
import { cn } from "@shared/utils";
import { isTextEditableFile } from "@features/books/lib/paths";
import { RelationPopover } from "./RelationPopover";
import type { TreeNode, WorkspaceRelation } from "@features/books/types";

type BookTreeItemProps = {
  activeFilePath: string | null;
  depth: number;
  expandedPaths: string[];
  node: TreeNode;
  agentContextFilePaths?: string[];
  onAddToAgentContext?: (path: string) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onDelete: (node: TreeNode) => void;
  // —— 文件关联(可选,缺省时不渲染关联图标) ——
  onAddRelation?: (entryPath: string) => void;
  onDeleteRelation?: (relation: WorkspaceRelation) => void;
  onEditRelation?: (relation: WorkspaceRelation) => void;
  relationCountByPath?: Record<string, number>;
  relationsByPath?: Record<string, WorkspaceRelation[]>;
  rootPath?: string;
  // —— 已有 props ——
  onRename: (node: TreeNode) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
};

// 文件树节点:操作菜单改用 shadcn DropdownMenu,省去原本的浮层定位逻辑。
export function BookTreeItem({
  activeFilePath,
  agentContextFilePaths = [],
  depth,
  expandedPaths,
  node,
  onAddRelation,
  onAddToAgentContext,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onDeleteRelation,
  onEditRelation,
  onRename,
  onSelectFile,
  onToggleDirectory,
  relationCountByPath = {},
  relationsByPath = {},
  rootPath,
}: BookTreeItemProps) {
  const isDirectory = node.kind === "directory";
  const isExpanded = isDirectory && expandedPaths.includes(node.path);
  const isSelected = activeFilePath === node.path;
  const isEditable = !isDirectory && isTextEditableFile(node.name);
  const isInAgentContext = agentContextFilePaths.includes(node.path);
  const relationCount = !isDirectory ? (relationCountByPath[node.path] ?? 0) : 0;
  const nodeRelations = !isDirectory ? (relationsByPath[node.path] ?? []) : [];
  const relationFeatureAvailable =
    !isDirectory
    && isEditable
    && Boolean(rootPath)
    && Boolean(onAddRelation)
    && Boolean(onEditRelation)
    && Boolean(onDeleteRelation);

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
        className={cn(
          "group flex items-center gap-1 transition",
          isSelected
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => {
            if (isDirectory) {
              onToggleDirectory(node.path);
              return;
            }
            if (isEditable) {
              onSelectFile(node.path);
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-1 py-2 text-left"
        >
          {isDirectory ? (
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                isExpanded ? "rotate-90" : "rotate-0",
              )}
            />
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <FolderClosed className="h-4 w-4 shrink-0 text-primary" />
            )
          ) : (
            <FileText
              className={cn(
                "h-4 w-4 shrink-0",
                isEditable ? "text-muted-foreground" : "text-muted-foreground/45",
              )}
            />
          )}
          <span
            className={cn(
              "truncate text-sm font-medium",
              !isDirectory && !isEditable ? "opacity-50" : "opacity-100",
            )}
          >
            {node.name}
          </span>
        </button>
        {relationFeatureAvailable && rootPath ? (
          <RelationPopover
            entryPath={node.path}
            onAddRelation={() => onAddRelation?.(node.path)}
            onDeleteRelation={(relation) => onDeleteRelation?.(relation)}
            onEditRelation={(relation) => onEditRelation?.(relation)}
            onSelectEntry={(otherPath) => onSelectFile(otherPath)}
            relations={nodeRelations}
            rootPath={rootPath}
          >
            <Button
              type="button"
              aria-label={`${node.name} 关联文件`}
              title={`${node.name} 的关联 — 查看引用关系`}
              variant="ghost"
              size="icon-sm"
              className={cn(
                "relative shrink-0 hover:bg-panel-subtle",
                relationCount > 0
                  ? "text-primary opacity-100"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100",
              )}
            >
              <Link2 className="h-4 w-4" />
              {relationCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
                  {relationCount > 99 ? "99+" : relationCount}
                </span>
              ) : null}
            </Button>
          </RelationPopover>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              aria-label={`${node.name} 更多操作`}
              title={`${node.name} 更多操作 — 打开这个文件或文件夹的操作菜单`}
              variant="ghost"
              size="icon-sm"
              className={cn(
                "shrink-0 text-muted-foreground hover:bg-panel-subtle hover:text-foreground",
                isSelected
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100",
              )}
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {isDirectory ? (
              <>
                <DropdownMenuItem className="gap-2" onSelect={() => onCreateFolder(node.path)}>
                  <FolderPlus className="h-4 w-4" />
                  新建文件夹
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={() => onCreateFile(node.path)}>
                  <FilePlus2 className="h-4 w-4" />
                  新建文件
                </DropdownMenuItem>
              </>
            ) : null}
            {!isDirectory && onAddToAgentContext ? (
              <DropdownMenuItem
                disabled={isInAgentContext}
                onSelect={() => onAddToAgentContext(node.path)}
                title={isInAgentContext ? "这个文件已在 Agent 上下文中" : "添加到 Agent 上下文"}
                className="gap-2"
              >
                <AtSign className="h-4 w-4" />
                {isInAgentContext ? "已在上下文中" : "添加到上下文"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="gap-2" onSelect={() => onRename(node)}>
              <Pencil className="h-4 w-4" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" variant="destructive" onSelect={() => onDelete(node)}>
              <Trash2 className="h-4 w-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isDirectory && isExpanded ? (
        <div className="space-y-1">
          {node.children?.map((child) => (
            <BookTreeItem
              key={child.path}
              activeFilePath={activeFilePath}
              agentContextFilePaths={agentContextFilePaths}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              node={child}
              onAddRelation={onAddRelation}
              onAddToAgentContext={onAddToAgentContext}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDelete={onDelete}
              onDeleteRelation={onDeleteRelation}
              onEditRelation={onEditRelation}
              onRename={onRename}
              onSelectFile={onSelectFile}
              onToggleDirectory={onToggleDirectory}
              relationCountByPath={relationCountByPath}
              relationsByPath={relationsByPath}
              rootPath={rootPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
