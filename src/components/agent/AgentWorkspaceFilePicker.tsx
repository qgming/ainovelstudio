import { Check, ChevronRight, FileText, Folder } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "../../lib/bookWorkspace/types";

type AgentWorkspaceFilePickerProps = {
  rootNode: TreeNode | null;
  selectedFilePaths: string[];
  onToggleFile: (path: string) => void;
};

type TreeRowProps = {
  depth: number;
  node: TreeNode;
  onToggleFile: (path: string) => void;
  selectedFilePaths: string[];
};

function TreeRow({ depth, node, onToggleFile, selectedFilePaths }: TreeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isDirectory = node.kind === "directory";
  const isSelected = selectedFilePaths.includes(node.path);
  const paddingLeft = 2 + depth * 8;

  if (isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center gap-2 py-1.5 text-left text-sm text-[#1f2937] transition hover:text-black dark:text-[#e5e7eb] dark:hover:text-white"
          style={{ paddingLeft }}
        >
          <ChevronRight className={["h-4 w-4 shrink-0 transition-transform", expanded ? "rotate-90" : ""].join(" ")} />
          <Folder className="h-4 w-4 shrink-0 text-[#7b8798] dark:text-[#8b97a8]" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded ? (
          <div>
            {(node.children ?? []).map((child) => (
              <TreeRow
                key={child.path}
                depth={depth + 1}
                node={child}
                onToggleFile={onToggleFile}
                selectedFilePaths={selectedFilePaths}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onToggleFile(node.path)}
      className="flex w-full items-center gap-2 py-1.5 text-left text-sm transition hover:text-black dark:hover:text-white"
      style={{ paddingLeft }}
    >
      <span className="h-4 w-4 shrink-0" />
      <FileText className="h-4 w-4 shrink-0 text-[#7b8798] dark:text-[#8b97a8]" />
      <span className="min-w-0 flex-1 truncate text-[#1f2937] dark:text-[#e5e7eb]">{node.name}</span>
      <span
        className={[
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
          isSelected
            ? "border-[#111827] bg-[#111827] text-white dark:border-[#f3f4f6] dark:bg-[#f3f4f6] dark:text-[#111827]"
            : "border-[#cfd8e3] text-transparent dark:border-[#39424f]",
        ].join(" ")}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

export function AgentWorkspaceFilePicker({
  rootNode,
  selectedFilePaths,
  onToggleFile,
}: AgentWorkspaceFilePickerProps) {
  if (!rootNode) {
    return <p className="px-2 py-2 text-sm text-[#718096] dark:text-[#7f8a9b]">当前没有打开工作区。</p>;
  }

  return (
    <div>
      <div>
        {(rootNode.children ?? []).length > 0 ? (
          (rootNode.children ?? []).map((child) => (
            <TreeRow
              key={child.path}
              depth={0}
              node={child}
              onToggleFile={onToggleFile}
              selectedFilePaths={selectedFilePaths}
            />
          ))
        ) : (
          <TreeRow depth={0} node={rootNode} onToggleFile={onToggleFile} selectedFilePaths={selectedFilePaths} />
        )}
      </div>
    </div>
  );
}
