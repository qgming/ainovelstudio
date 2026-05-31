import {
  FilePlus2,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@shared/ui/button";
import { PanelBody, PanelHeader, PanelToolbar } from "@shared/ui/panel";
import { cn } from "@shared/utils";
import { BookTreeItem } from "./BookTreeItem";
import type { TreeNode, WorkspaceRelation } from "@features/books/types";

type BookTreePanelProps = {
  activeFilePath: string | null;
  agentContextFilePaths?: string[];
  busy?: boolean;
  expandedPaths: string[];
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onAddToAgentContext?: (path: string) => void;
  onDelete: (node: TreeNode) => void;
  // —— 文件关联(可选) ——
  onAddRelation?: (entryPath: string) => void;
  onDeleteRelation?: (relation: WorkspaceRelation) => void;
  onEditRelation?: (relation: WorkspaceRelation) => void;
  relationCountByPath?: Record<string, number>;
  relationsByPath?: Record<string, WorkspaceRelation[]>;
  // —— 已有 ——
  onNavigateHome: () => void;
  onOpenRootFolder?: () => void;
  onRefresh: () => void;
  onRename: (node: TreeNode) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  resizeHandle?: React.ReactNode;
  rootNode: TreeNode;
  variant?: "card" | "flush";
  width?: number | string;
};

function getToolbarButtonTitle(ariaLabel: string) {
  if (ariaLabel === "刷新当前书籍") {
    return "刷新当前书籍 — 重新读取当前书籍的文件结构";
  }
  if (ariaLabel === "在系统文件资源管理器中打开书籍文件夹") {
    return "在系统文件资源管理器中打开书籍文件夹 — 方便直接添加、删除或整理文件";
  }
  if (ariaLabel === "在书籍根目录中新建文件夹") {
    return "在书籍根目录中新建文件夹 — 在当前书籍根目录创建新文件夹";
  }
  return "在书籍根目录中新建文件 — 在当前书籍根目录创建新文件";
}

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
      title={getToolbarButtonTitle(ariaLabel)}
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
      title="返回首页 — 回到书架主页"
      disabled={busy}
      onClick={onClick}
      variant="ghost"
      size="sm"
      className="h-8 min-w-0 justify-start px-1 text-foreground"
    >
      <span className="truncate text-[13px] font-medium leading-5 tracking-[0.01em]">
        {name}
      </span>
    </Button>
  );
}

export function BookTreePanel({
  activeFilePath,
  agentContextFilePaths = [],
  busy = false,
  expandedPaths,
  onAddRelation,
  onCreateFile,
  onCreateFolder,
  onAddToAgentContext,
  onDelete,
  onDeleteRelation,
  onEditRelation,
  onNavigateHome,
  onOpenRootFolder,
  onRefresh,
  onRename,
  onSelectFile,
  onToggleDirectory,
  relationCountByPath,
  relationsByPath,
  resizeHandle,
  rootNode,
  variant = "flush",
  width,
}: BookTreePanelProps) {
  return (
    <aside
      style={width ? { width } : undefined}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden",
        variant === "card"
          ? "relative box-border rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none"
          : "bg-app",
      )}
    >
      <PanelHeader className="border-b-0 bg-transparent px-2">
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
          {onOpenRootFolder ? (
            <ToolbarButton
              ariaLabel="在系统文件资源管理器中打开书籍文件夹"
              busy={busy}
              onClick={onOpenRootFolder}
            >
              <FolderOpen className="h-4 w-4" />
            </ToolbarButton>
          ) : null}
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
              agentContextFilePaths={agentContextFilePaths}
              depth={0}
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
              rootPath={rootNode.path}
            />
          ))}
        </div>
      </PanelBody>
      {resizeHandle}
    </aside>
  );
}
