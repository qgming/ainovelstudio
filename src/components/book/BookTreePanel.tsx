import {
  FilePlus2,
  FolderPlus,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { collectAllDirectoryPaths } from "../../lib/bookWorkspace/tree";
import { BookTreeItem } from "./BookTreeItem";
import type { TreeNode } from "../../lib/bookWorkspace/types";

type BookTreePanelProps = {
  activeFilePath: string | null;
  busy?: boolean;
  expandedPaths: string[];
  onToggleAll: () => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onDelete: (node: TreeNode) => void;
  onRefresh: () => void;
  onRename: (node: TreeNode) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  rootNode: TreeNode;
  width: number;
};

function ToolbarButton({
  ariaLabel,
  busy = false,
  children,
  onClick,
}: {
  ariaLabel: string;
  busy?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={busy}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-[#1a1c21]"
    >
      {children}
    </button>
  );
}

export function BookTreePanel({
  activeFilePath,
  busy = false,
  expandedPaths,
  onToggleAll,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onRefresh,
  onRename,
  onSelectFile,
  onToggleDirectory,
  rootNode,
  width,
}: BookTreePanelProps) {
  const allDirectoryPaths = collectAllDirectoryPaths(rootNode);
  const isFullyExpanded =
    allDirectoryPaths.length > 0 &&
    allDirectoryPaths.every((path) => expandedPaths.includes(path));

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-2 dark:border-[#20242b]">
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
          {rootNode.name}
        </h2>
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            ariaLabel="刷新当前书籍"
            busy={busy}
            onClick={onRefresh}
          >
            <RefreshCw
              className={["h-4 w-4", busy ? "animate-spin" : ""].join(" ")}
            />
          </ToolbarButton>
          <ToolbarButton
            ariaLabel={isFullyExpanded ? "折叠全部文件夹" : "展开全部文件夹"}
            busy={busy}
            onClick={onToggleAll}
          >
            {isFullyExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </ToolbarButton>
          <ToolbarButton
            ariaLabel="在书籍根目录中新建文件夹"
            busy={busy}
            onClick={() => onCreateFolder(rootNode.path)}
          >
            <FolderPlus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            ariaLabel="在书籍根目录中新建文本文件"
            busy={busy}
            onClick={() => onCreateFile(rootNode.path)}
          >
            <FilePlus2 className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div role="tree" aria-label="书籍文件树" className="space-y-1">
          {rootNode.children?.map((child) => (
            <BookTreeItem
              key={child.path}
              activeFilePath={activeFilePath}
              depth={0}
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
      </div>
    </aside>
  );
}
