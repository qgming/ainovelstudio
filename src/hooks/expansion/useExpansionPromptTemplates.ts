/**
 * 扩写模式提示词主体 hook：按 workspaceId 加载/保存/重置自定义指令主体（不含变量头部）。
 *
 * 数据库未命中时回退到 DEFAULT_PROMPT_BODIES。getBody 在加载完成前
 * 也会立即返回默认值，保证按钮点击随时可用。
 */

import { useCallback, useEffect, useState } from "react";
import {
  listExpansionPromptTemplates,
  resetExpansionPromptTemplate,
  saveExpansionPromptTemplate,
} from "../../lib/expansion/api";
import { DEFAULT_PROMPT_BODIES } from "../../lib/expansion/promptTemplates";
import type { ExpansionWorkspaceActionId } from "../../components/expansion/detail/ExpansionWorkspacePanel";

type Overrides = Partial<Record<ExpansionWorkspaceActionId, string>>;

export function useExpansionPromptTemplates(workspaceId: string | undefined) {
  const [overrides, setOverrides] = useState<Overrides>({});

  useEffect(() => {
    if (!workspaceId) {
      setOverrides({});
      return;
    }
    let cancelled = false;
    void listExpansionPromptTemplates(workspaceId)
      .then((items) => {
        if (cancelled) return;
        const next: Overrides = {};
        for (const item of items) {
          next[item.actionId as ExpansionWorkspaceActionId] = item.template;
        }
        setOverrides(next);
      })
      .catch(() => {
        if (!cancelled) setOverrides({});
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const getBody = useCallback(
    (actionId: ExpansionWorkspaceActionId): string =>
      overrides[actionId] ?? DEFAULT_PROMPT_BODIES[actionId],
    [overrides],
  );

  const isCustomized = useCallback(
    (actionId: ExpansionWorkspaceActionId): boolean => actionId in overrides,
    [overrides],
  );

  const saveBody = useCallback(
    async (actionId: ExpansionWorkspaceActionId, body: string) => {
      if (!workspaceId) return;
      await saveExpansionPromptTemplate(workspaceId, actionId, body);
      setOverrides((current) => ({ ...current, [actionId]: body }));
    },
    [workspaceId],
  );

  const resetBody = useCallback(
    async (actionId: ExpansionWorkspaceActionId) => {
      if (!workspaceId) return;
      await resetExpansionPromptTemplate(workspaceId, actionId);
      setOverrides((current) => {
        if (!(actionId in current)) return current;
        const next = { ...current };
        delete next[actionId];
        return next;
      });
    },
    [workspaceId],
  );

  return { getBody, isCustomized, resetBody, saveBody };
}
