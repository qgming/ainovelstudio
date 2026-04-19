import {
  ChevronRight,
  FilePlus2,
  FolderPlus,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelBody, PanelHeader, PanelToolbar } from "@/components/ui/panel";
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
  onNavigateHome: () => void;
  onRefresh: () => void;
  onRename: (node: TreeNode) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  rootNode: TreeNode;
  width?: number | string;
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
    <Button
      type="button"
      aria-label={ariaLabel}
      disabled={busy}
      onClick={onClick}
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
    >
      {children}
    </Button>
  );
}

function WorkspaceButton({
  busy = false,
  name,
  onClick,
}: {
  busy?: boolean;
  name: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      aria-label="返回首页"
      disabled={busy}
      onClick={onClick}
      variant="ghost"
      size="sm"
      className="h-7 min-w-0 justify-start gap-1 px-1 text-foreground"
    >
      <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
      <span className="truncate text-[13px] font-medium leading-none tracking-[0.01em]">
        {name}
      </span>
    </Button>
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
  onNavigateHome,
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
      style={width ? { width } : undefined}
      className="flex h-full shrink-0 flex-col overflow-hidden bg-app"
    >
      <PanelHeader className="bg-transparent px-0">
        <WorkspaceButton
          busy={busy}
          name={rootNode.name}
          onClick={onNavigateHome}
        />
        <PanelToolbar className="gap-0.5">
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
            ariaLabel="在书籍根目录中新建文件"
            busy={busy}
            onClick={() => onCreateFile(rootNode.path)}
          >
            <FilePlus2 className="h-4 w-4" />
          </ToolbarButton>
        </PanelToolbar>
      </PanelHeader>
      <PanelBody className="overflow-auto">
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
      </PanelBody>
    </aside>
  );
}
