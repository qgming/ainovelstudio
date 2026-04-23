import { ChevronRight, Ellipsis, FileText, FolderClosed, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isTextEditableFile } from "../../lib/bookWorkspace/paths";
import type { TreeNode } from "../../lib/bookWorkspace/types";

type BookTreeItemProps = {
  activeFilePath: string | null;
  depth: number;
  expandedPaths: string[];
  node: TreeNode;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onDelete: (node: TreeNode) => void;
  onRename: (node: TreeNode) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
};

// 文件树节点：操作菜单改用 shadcn DropdownMenu，省去原本的浮层定位逻辑。
export function BookTreeItem({
  activeFilePath,
  depth,
  expandedPaths,
  node,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onRename,
  onSelectFile,
  onToggleDirectory,
}: BookTreeItemProps) {
  const isDirectory = node.kind === "directory";
  const isExpanded = isDirectory && expandedPaths.includes(node.path);
  const isSelected = activeFilePath === node.path;
  const isEditable = !isDirectory && isTextEditableFile(node.name);

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
                <DropdownMenuItem onSelect={() => onCreateFolder(node.path)}>
                  新建文件夹
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCreateFile(node.path)}>
                  新建文件
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => onRename(node)}>重命名</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(node)}>
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
              depth={depth + 1}
              expandedPaths={expandedPaths}
              node={child}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDelete={onDelete}
              onRename={onRename}
              onSelectFile={onSelectFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
