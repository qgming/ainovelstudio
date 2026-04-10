/** 内置工具元数据定义，设置页和 session 共用 */
export type ToolDef = {
  /** 工具唯一标识，与 tools.ts 中的 key 一致 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 功能描述 */
  description: string;
};

export const BUILTIN_TOOLS: ToolDef[] = [
  { id: "read_file", name: "读取文件", description: "读取指定文本文件内容" },
  { id: "write_file", name: "写入文件", description: "将内容写回文本文件" },
  { id: "line_edit", name: "行编辑", description: "按行读取或替换指定文件中的文本内容" },
  {
    id: "search_workspace_content",
    name: "内容搜索",
    description: "搜索文件夹名、文件名和正文内容，并返回路径、行号与命中行",
  },
  { id: "create_file", name: "创建文件", description: "在指定目录中创建文本文件" },
  { id: "create_folder", name: "创建文件夹", description: "在指定目录中创建文件夹" },
  { id: "delete_path", name: "删除路径", description: "删除指定文件或目录" },
  { id: "rename_path", name: "重命名", description: "重命名工作区文件或目录" },
  { id: "read_workspace_tree", name: "读取目录树", description: "读取当前工作区目录树" },
];

/** 返回默认全部启用的工具映射 */
export function getDefaultEnabledTools(): Record<string, boolean> {
  return Object.fromEntries(BUILTIN_TOOLS.map((t) => [t.id, true]));
}
