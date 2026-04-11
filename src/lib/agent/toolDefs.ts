/** 内置工具元数据定义，设置页和 session 共用 */
export type ToolDef = {
  /** 工具唯一标识，与 tools.ts 中的 key 一致 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 设置页和 prompt 使用的简短描述 */
  description: string;
};

export const BUILTIN_TOOLS: ToolDef[] = [
  {
    id: "read_file",
    name: "读取文件",
    description: "读取完整文本文件；已知路径且需要全文上下文时使用，定位阶段优先先搜索。",
  },
  {
    id: "write_file",
    name: "写入文件",
    description: "整文件覆盖写入；只有准备好完整新内容时再用，小改动优先行编辑。",
  },
  {
    id: "line_edit",
    name: "行编辑",
    description: "按行读取或替换文本；适合小范围修改，replace 仅支持单行且 contents 不能换行。",
  },
  {
    id: "search_workspace_content",
    name: "内容搜索",
    description: "搜索目录名、文件名和正文内容，用于先定位目标，不直接返回完整文件。",
  },
  {
    id: "create_file",
    name: "创建文件",
    description: "在指定目录创建新文本文件；适合新增文件，不用于覆盖已有文件内容。",
  },
  {
    id: "create_folder",
    name: "创建文件夹",
    description: "在指定目录创建文件夹；适合补齐工作区结构。",
  },
  {
    id: "delete_path",
    name: "删除路径",
    description: "删除指定文件或目录；执行前应再次确认目标路径和影响范围。",
  },
  {
    id: "rename_path",
    name: "重命名",
    description: "重命名工作区文件或目录；适合改名，不会修改文件正文。",
  },
  {
    id: "read_workspace_tree",
    name: "读取目录树",
    description: "读取当前工作区目录结构；适合浏览层级和入口，不搜索正文。",
  },
];

/** 返回默认全部启用的工具映射 */
export function getDefaultEnabledTools(): Record<string, boolean> {
  return Object.fromEntries(BUILTIN_TOOLS.map((t) => [t.id, true]));
}
