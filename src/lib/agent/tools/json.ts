import { isPlainObject } from "./shared";

export type JsonAction = "append" | "delete" | "get" | "merge" | "set";

type JsonObject = Record<string, unknown>;
type JsonContainer = unknown[] | JsonObject;

export function normalizeJsonAction(value: unknown): JsonAction {
  if (
    value === "append" ||
    value === "delete" ||
    value === "merge" ||
    value === "set"
  ) {
    return value;
  }
  return "get";
}

function detectJsonIndentation(contents: string) {
  const match = contents.match(/\n([ \t]+)(?:"|[}\]])/);
  return match?.[1] ?? 2;
}

function detectLineEnding(contents: string) {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function parseJsonDocument(contents: string, path: string) {
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析失败";
    throw new Error(`${path} 不是合法 JSON：${message}`);
  }
}

export function parseJsonPointer(pointer: string) {
  const normalized = String(pointer ?? "").trim();
  if (!normalized) {
    return [];
  }
  if (!normalized.startsWith("/")) {
    throw new Error("json.pointer 必须为空字符串或以 / 开头。");
  }

  return normalized
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function ensureJsonContainer(value: unknown, pointer: string): JsonContainer {
  if (Array.isArray(value) || isPlainObject(value)) {
    return value;
  }

  throw new Error(`${pointer || "/"} 对应的节点不是对象或数组。`);
}

function parseArrayIndex(segment: string, length: number, allowEnd: boolean) {
  if (!/^\d+$/.test(segment)) {
    throw new Error(`JSON Pointer 数组下标无效：${segment}`);
  }

  const index = Number.parseInt(segment, 10);
  if (allowEnd) {
    if (index > length) {
      throw new Error(`JSON Pointer 数组下标越界：${segment}`);
    }
    return index;
  }

  if (index >= length) {
    throw new Error(`JSON Pointer 数组下标越界：${segment}`);
  }
  return index;
}

export function getJsonValueAtPointer(root: unknown, segments: string[]) {
  let current = root;

  for (const segment of segments) {
    const container = ensureJsonContainer(current, `/${segments.join("/")}`);
    if (Array.isArray(container)) {
      current = container[parseArrayIndex(segment, container.length, false)];
      continue;
    }

    if (segment in container) {
      current = container[segment];
      continue;
    }

    throw new Error(`JSON Pointer 未找到目标节点：/${segments.join("/")}`);
  }

  return current;
}

function readOptionalJsonValue(root: unknown, segments: string[]) {
  try {
    return getJsonValueAtPointer(root, segments);
  } catch {
    return undefined;
  }
}

function ensureJsonParent(root: unknown, segments: string[]) {
  if (segments.length === 0) {
    return root;
  }

  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const nextValue = nextSegment && /^\d+$/.test(nextSegment) ? [] : {};
    const pointer = `/${segments.slice(0, index).join("/")}`;
    const container = ensureJsonContainer(current, pointer);

    if (Array.isArray(container)) {
      const arrayIndex = parseArrayIndex(segment, container.length, true);
      if (container[arrayIndex] == null) {
        container[arrayIndex] = nextValue;
      }
      current = container[arrayIndex];
      continue;
    }

    if (!(segment in container) || container[segment] == null) {
      container[segment] = nextValue;
    }
    current = container[segment];
  }

  return current;
}

export function setJsonValueAtPointer(
  root: unknown,
  segments: string[],
  value: unknown,
) {
  if (segments.length === 0) {
    return cloneJsonValue(value);
  }

  const parent = ensureJsonParent(root, segments.slice(0, -1));
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(parent)) {
    parent[parseArrayIndex(lastSegment, parent.length, true)] =
      cloneJsonValue(value);
    return root;
  }

  if (isPlainObject(parent)) {
    parent[lastSegment] = cloneJsonValue(value);
    return root;
  }

  throw new Error(`JSON Pointer 无法写入到 ${segments.join("/")}`);
}

export function mergeJsonValueAtPointer(
  root: unknown,
  segments: string[],
  value: unknown,
) {
  if (!isPlainObject(value)) {
    throw new Error("json.merge 需要 object 类型的 value。");
  }

  let nextRoot = root;
  let target = readOptionalJsonValue(nextRoot, segments);
  if (target === undefined) {
    nextRoot = setJsonValueAtPointer(nextRoot, segments, {});
    target = getJsonValueAtPointer(nextRoot, segments);
  }
  if (!isPlainObject(target)) {
    throw new Error("json.merge 目标节点必须是对象。");
  }

  Object.assign(target, cloneJsonValue(value));
  return nextRoot;
}

export function appendJsonValueAtPointer(
  root: unknown,
  segments: string[],
  value: unknown,
) {
  let nextRoot = root;
  let target = readOptionalJsonValue(nextRoot, segments);
  if (target === undefined) {
    nextRoot = setJsonValueAtPointer(nextRoot, segments, []);
    target = getJsonValueAtPointer(nextRoot, segments);
  }
  if (!Array.isArray(target)) {
    throw new Error("json.append 目标节点必须是数组。");
  }

  target.push(cloneJsonValue(value));
  return nextRoot;
}

export function deleteJsonValueAtPointer(root: unknown, segments: string[]) {
  if (segments.length === 0) {
    throw new Error("json.delete 不能删除根节点。");
  }

  const parent = getJsonValueAtPointer(root, segments.slice(0, -1));
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(parent)) {
    parent.splice(parseArrayIndex(lastSegment, parent.length, false), 1);
    return root;
  }

  if (isPlainObject(parent)) {
    if (!(lastSegment in parent)) {
      throw new Error(`JSON Pointer 未找到目标节点：/${segments.join("/")}`);
    }
    delete parent[lastSegment];
    return root;
  }

  throw new Error(`JSON Pointer 无法删除 ${segments.join("/")}`);
}

export function serializeJsonWithStyle(value: unknown, originalContents: string) {
  const rendered = JSON.stringify(
    value,
    null,
    detectJsonIndentation(originalContents),
  );
  const lineEnding = detectLineEnding(originalContents);
  const normalized = rendered.replace(/\n/g, lineEnding);
  if (originalContents.endsWith("\r\n") || originalContents.endsWith("\n")) {
    return `${normalized}${lineEnding}`;
  }
  return normalized;
}
