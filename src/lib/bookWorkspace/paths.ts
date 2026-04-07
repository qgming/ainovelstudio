const INVALID_NAME_PATTERN = /[<>:"/\\|?*]/;

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

export function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function getBaseName(path: string): string {
  const parts = splitPath(path);
  return parts.at(-1) ?? "";
}

export function getParentPath(path: string): string {
  const parts = splitPath(path);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export function getExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > -1 ? name.slice(index).toLowerCase() : "";
}

export function isTextEditableFile(name: string): boolean {
  const extension = getExtension(name);
  return extension === ".md" || extension === ".txt";
}

export function isHiddenSystemFile(name: string): boolean {
  return name === "index.json";
}

export function normalizeEntryName(value: string): string {
  return value.trim();
}

export function validateEntryName(value: string): string | null {
  const name = normalizeEntryName(value);

  if (!name) {
    return "名称不能为空。";
  }

  if (name === "." || name === "..") {
    return "名称不能是 . 或 ..。";
  }

  if (INVALID_NAME_PATTERN.test(name)) {
    return "名称不能包含 < > : \" / \\ | ? *。";
  }

  if (isHiddenSystemFile(name)) {
    return "index.json 由系统维护，不能手动创建或重命名。";
  }

  return null;
}
