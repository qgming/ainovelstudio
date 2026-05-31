// CP-F：模式工具白名单过滤的共享实现（取代 messageSessionFactory.getEnabledToolIds）。

/**
 * 从全部已启用工具 id 过滤出某模式应使用的集合。
 * - 剔除「控制工具」中不属于本模式的（如 book 模式剔除 yolo_control）。
 * - 强制带上本模式所需的控制工具（如 autopilot 强制带 yolo_control），即便用户未在设置里开启。
 *
 * @param allEnabled        用户在设置里启用的全部工具 id
 * @param requiredControlToolId 本模式必须启用的控制工具 id（无则 null）
 * @param controlToolIds    全部「受模式管控的控制工具」id 集合，非本模式的会被剔除
 */
export function filterEnabledToolIdsForMode(
  allEnabled: readonly string[],
  requiredControlToolId: string | null,
  controlToolIds: readonly string[],
): string[] {
  const controlSet = new Set(controlToolIds);
  const filtered = allEnabled.filter((id) => {
    // 非控制工具一律保留；控制工具仅保留本模式所需的那个。
    if (!controlSet.has(id)) return true;
    return id === requiredControlToolId;
  });
  if (requiredControlToolId && !filtered.includes(requiredControlToolId)) {
    return [requiredControlToolId, ...filtered];
  }
  return filtered;
}
