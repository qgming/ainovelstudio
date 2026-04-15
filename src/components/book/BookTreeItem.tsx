import { useState } from "react";
import { ChevronRight, Ellipsis, FileText, FolderClosed, FolderOpen } from "lucide-react";
import { ActionMenu, ActionMenuItem, type ActionMenuAnchorRect } from "../common/ActionMenu";
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

function toAnchorRect(rect: DOMRect): ActionMenuAnchorRect {
  return {
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top,
  };
}

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
  const [menuAnchorRect, setMenuAnchorRect] = useState<ActionMenuAnchorRect | null>(null);

  const closeMenu = () => {
    setMenuAnchorRect(null);
  };

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextAnchorRect = toAnchorRect(event.currentTarget.getBoundingClientRect());
    setMenuAnchorRect((current) => (current ? null : nextAnchorRect));
  };

  const runMenuAction = (action: () => void) => {
    closeMenu();
    action();
  };

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
        className={[
          "group flex items-center gap-1 transition",
          isSelected
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        ].join(" ")}
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
              className={[
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                isExpanded ? "rotate-90" : "rotate-0",
              ].join(" ")}
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
              className={[
                "h-4 w-4 shrink-0",
                isEditable
                  ? "text-muted-foreground"
                  : "text-muted-foreground/45",
              ].join(" ")}
            />
          )}
          <span
            className={[
              "truncate text-sm font-medium",
              !isDirectory && !isEditable ? "opacity-50" : "opacity-100",
            ].join(" ")}
          >
            {node.name}
          </span>
        </button>
        <button
          type="button"
          aria-label={`${node.name} 更多操作`}
          onClick={openMenu}
          className={[
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:bg-panel-subtle hover:text-foreground",
            menuAnchorRect || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          ].join(" ")}
        >
          <Ellipsis className="h-4 w-4" />
        </button>
        <ActionMenu anchorRect={menuAnchorRect} onClose={closeMenu} width={180}>
          <div className="space-y-1">
            {isDirectory ? (
              <>
                <ActionMenuItem onClick={() => runMenuAction(() => onCreateFolder(node.path))}>
                  新建文件夹
                </ActionMenuItem>
                <ActionMenuItem onClick={() => runMenuAction(() => onCreateFile(node.path))}>
                  新建文件
                </ActionMenuItem>
              </>
            ) : null}
            <ActionMenuItem onClick={() => runMenuAction(() => onRename(node))}>重命名</ActionMenuItem>
            <ActionMenuItem onClick={() => runMenuAction(() => onDelete(node))}>删除</ActionMenuItem>
          </div>
        </ActionMenu>
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
