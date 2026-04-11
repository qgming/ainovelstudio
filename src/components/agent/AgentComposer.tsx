import { AtSign, SendHorizontal, Square, SquareSlash, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { getBaseName } from "../../lib/bookWorkspace/paths";
import type { TreeNode } from "../../lib/bookWorkspace/types";
import type { ManualTurnContextSelection } from "../../lib/agent/manualTurnContext";
import type { AgentRunStatus } from "../../lib/agent/types";
import { ActionMenu, type ActionMenuAnchorRect } from "../common/ActionMenu";
import { AgentManualResourcePicker } from "./AgentManualResourcePicker";
import { AgentWorkspaceFilePicker } from "./AgentWorkspaceFilePicker";

type SelectableResource = {
  description?: string;
  id: string;
  kind: "agent" | "skill";
  name: string;
};

type AgentComposerProps = {
  input: string;
  onInputChange: (value: string) => void;
  onStop: () => void;
  onSubmit: (selection: ManualTurnContextSelection) => void;
  resources: SelectableResource[];
  rootNode: TreeNode | null;
  runStatus: AgentRunStatus;
};

function toAnchorRect(rect: DOMRect): ActionMenuAnchorRect {
  return {
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top,
  };
}

function removeValue(values: string[], value: string) {
  return values.filter((item) => item !== value);
}

export function AgentComposer({
  input,
  onInputChange,
  onStop,
  onSubmit,
  resources,
  rootNode,
  runStatus,
}: AgentComposerProps) {
  const isRunning = runStatus === "running";
  const [resourceAnchorRect, setResourceAnchorRect] = useState<ActionMenuAnchorRect | null>(null);
  const [fileAnchorRect, setFileAnchorRect] = useState<ActionMenuAnchorRect | null>(null);
  const [selection, setSelection] = useState<ManualTurnContextSelection>({
    agentIds: [],
    filePaths: [],
    skillIds: [],
  });

  const selectedItems = useMemo(() => {
    const resourceItems = resources
      .filter((resource) => selection.skillIds.includes(resource.id) || selection.agentIds.includes(resource.id))
      .map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        label: resource.name,
      }));
    const fileItems = selection.filePaths.map((path) => ({
      id: path,
      kind: "file" as const,
      label: getBaseName(path),
    }));
    return [...resourceItems, ...fileItems];
  }, [resources, selection.agentIds, selection.filePaths, selection.skillIds]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!isRunning && input.trim()) {
      onSubmit(selection);
      setSelection({ agentIds: [], filePaths: [], skillIds: [] });
    }
  };

  const handleResourceToggle = (resource: SelectableResource) => {
    setSelection((current) => {
      if (resource.kind === "skill") {
        return {
          ...current,
          skillIds: current.skillIds.includes(resource.id)
            ? removeValue(current.skillIds, resource.id)
            : [...current.skillIds, resource.id],
        };
      }

      return {
        ...current,
        agentIds: current.agentIds.includes(resource.id)
          ? removeValue(current.agentIds, resource.id)
          : [...current.agentIds, resource.id],
      };
    });
  };

  const handleFileToggle = (path: string) => {
    setSelection((current) => ({
      ...current,
      filePaths: current.filePaths.includes(path)
        ? removeValue(current.filePaths, path)
        : [...current.filePaths, path],
    }));
  };

  const handleRemoveSelected = (item: { id: string; kind: "agent" | "file" | "skill" }) => {
    setSelection((current) => {
      if (item.kind === "skill") {
        return { ...current, skillIds: removeValue(current.skillIds, item.id) };
      }
      if (item.kind === "agent") {
        return { ...current, agentIds: removeValue(current.agentIds, item.id) };
      }
      return { ...current, filePaths: removeValue(current.filePaths, item.id) };
    });
  };

  const handleSubmit = () => {
    onSubmit(selection);
    setSelection({ agentIds: [], filePaths: [], skillIds: [] });
  };

  return (
    <div className="border-t border-[#e2e8f0] bg-[#f7f7f8] dark:border-[#20242b] dark:bg-[#111214]">
      <ActionMenu
        anchorRect={resourceAnchorRect}
        maxHeight={680}
        onClose={() => setResourceAnchorRect(null)}
        width={220}
      >
        <AgentManualResourcePicker
          items={resources}
          onToggle={handleResourceToggle}
          selectedIds={[...selection.skillIds, ...selection.agentIds]}
        />
      </ActionMenu>
      <ActionMenu
        anchorRect={fileAnchorRect}
        maxHeight={760}
        onClose={() => setFileAnchorRect(null)}
        width={220}
      >
        <AgentWorkspaceFilePicker
          onToggleFile={handleFileToggle}
          rootNode={rootNode}
          selectedFilePaths={selection.filePaths}
        />
      </ActionMenu>

      {selectedItems.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-[#e7edf5] px-3 py-2 dark:border-[#232833]">
          {selectedItems.map((item) => (
            <span
              key={`${item.kind}-${item.id}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#dbe4f0] px-2.5 py-1 text-xs font-medium text-[#526074] dark:border-[#2a3039] dark:text-[#98a4b6]"
            >
              <span className="shrink-0">{item.kind === "file" ? "@" : "/"}</span>
              <span className="truncate">{item.label}</span>
              <button
                type="button"
                aria-label={`移除 ${item.label}`}
                onClick={() => handleRemoveSelected(item)}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[#7b8798] transition hover:bg-[#eef2f7] hover:text-[#111827] dark:text-[#8b97a8] dark:hover:bg-[#171b22] dark:hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden">
        <textarea
          aria-label="Agent 输入框"
          className="min-h-[96px] w-full resize-none border-none bg-transparent px-3 py-3 text-sm leading-6 text-[#1f2937] outline-none placeholder:text-[#8c97a8] dark:text-[#eef2f7] dark:placeholder:text-[#5f6b7d]"
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="让 agent 读取当前章节、调用技能和工具完成创作任务..."
          value={input}
        />
        <div className="flex items-center gap-3 border-t border-[#e7edf5] px-3 py-2 dark:border-[#232833]">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              aria-label="选择技能或子 Agent"
              disabled={isRunning}
              onClick={(event) => {
                const nextAnchorRect = toAnchorRect(event.currentTarget.getBoundingClientRect());
                setFileAnchorRect(null);
                setResourceAnchorRect((current) => (current ? null : nextAnchorRect));
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#526074] transition hover:bg-[#eef2f7] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#98a4b6] dark:hover:bg-[#171b22] dark:hover:text-white"
            >
              <SquareSlash className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="选择工作区文件"
              disabled={isRunning}
              onClick={(event) => {
                const nextAnchorRect = toAnchorRect(event.currentTarget.getBoundingClientRect());
                setResourceAnchorRect(null);
                setFileAnchorRect((current) => (current ? null : nextAnchorRect));
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#526074] transition hover:bg-[#eef2f7] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#98a4b6] dark:hover:bg-[#171b22] dark:hover:text-white"
            >
              <AtSign className="h-4 w-4" />
            </button>
            <span className="truncate text-[11px] text-[#7b8798] dark:text-[#657184]">Enter 发送，Shift + Enter 换行</span>
          </div>
          <div aria-hidden="true" className="h-8 w-px shrink-0 bg-[#e3e9f2] dark:bg-[#2a3039]" />
          <button
            type="button"
            aria-label={isRunning ? "停止输出" : "发送消息"}
            onClick={isRunning ? onStop : handleSubmit}
            disabled={!isRunning && !input.trim()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111827] text-white transition hover:bg-[#0b1220] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white"
          >
            {isRunning ? <Square className="h-4 w-4 fill-current" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
