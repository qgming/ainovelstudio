import type { ReactNode } from "react";
import {
  ChevronRight,
  FilePenLine,
  FileText,
  FolderClosed,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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

function ActionButton({
  label,
  onClick,
  children,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-7 w-7 items-center justify-center text-[#94a3b8] opacity-0 transition group-hover:opacity-100 hover:bg-[#eff6ff] hover:text-[#0b84e7] dark:text-[#758295] dark:hover:bg-[#162131] dark:hover:text-[#7cc4ff]"
    >
      {children}
    </button>
  );
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

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
        className={[
          "group flex items-center gap-1 pr-2 transition",
          isSelected
            ? "bg-[#eaf3ff] text-[#0f172a] dark:bg-[#162131] dark:text-[#f8fbff]"
            : "text-[#334155] hover:bg-[#eef2f7] dark:text-[#cbd5e1] dark:hover:bg-[#171b21]",
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
                "h-4 w-4 shrink-0 text-[#94a3b8] transition-transform duration-150 dark:text-[#64748b]",
                isExpanded ? "rotate-90" : "rotate-0",
              ].join(" ")}
            />
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-[#0b84e7] dark:text-[#7cc4ff]" />
            ) : (
              <FolderClosed className="h-4 w-4 shrink-0 text-[#0b84e7] dark:text-[#7cc4ff]" />
            )
          ) : (
            <FileText
              className={[
                "h-4 w-4 shrink-0",
                isEditable
                  ? "text-[#64748b] dark:text-[#94a3b8]"
                  : "text-[#cbd5e1] dark:text-[#475569]",
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
        {isDirectory ? (
          <div className="flex shrink-0 items-center gap-0">
            <ActionButton
              label={`在${node.name}中新建文件夹`}
              onClick={() => onCreateFolder(node.path)}
            >
              <FolderClosed className="h-3.5 w-3.5" />
            </ActionButton>
            <ActionButton
              label={`在${node.name}中新建文本文件`}
              onClick={() => onCreateFile(node.path)}
            >
              <Plus className="h-3.5 w-3.5" />
            </ActionButton>
            <ActionButton
              label={`重命名${node.name}`}
              onClick={() => onRename(node)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </ActionButton>
            <ActionButton
              label={`删除${node.name}`}
              onClick={() => onDelete(node)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </ActionButton>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-0">
            <ActionButton
              label={`重命名${node.name}`}
              onClick={() => onRename(node)}
            >
              <FilePenLine className="h-3.5 w-3.5" />
            </ActionButton>
            <ActionButton
              label={`删除${node.name}`}
              onClick={() => onDelete(node)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </ActionButton>
          </div>
        )}
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
