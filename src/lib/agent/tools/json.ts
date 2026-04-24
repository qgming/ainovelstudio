import { isPlainObject } from "./shared";

export type JsonAction =
  | "append"
  | "batch"
  | "delete"
  | "ensure_template"
  | "get"
  | "history_append"
  | "merge"
  | "patch"
  | "set"
  | "text_append";

export type JsonPatchOperation = {
  from?: string;
  op: "add" | "copy" | "move" | "remove" | "replace" | "test";
  path: string;
  value?: unknown;
};

type JsonObject = Record<string, unknown>;
type JsonContainer = unknown[] | JsonObject;

export function normalizeJsonAction(value: unknown): JsonAction {
  if (
    value === "append" ||
    value === "batch" ||
    value === "delete" ||
    value === "ensure_template" ||
    value === "history_append" ||
    value === "merge" ||
    value === "patch" ||
    value === "set" ||
    value === "text_append"
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

function normalizePatchPointer(pointer: string, label: string) {
  const normalized = String(pointer ?? "").trim();
  if (!normalized) {
    throw new Error(`${label} 需要提供 path。`);
  }
  return normalized;
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

function deepFillMissing(target: unknown, template: unknown): unknown {
  if (Array.isArray(template)) {
    return Array.isArray(target) ? target : cloneJsonValue(template);
  }

  if (!isPlainObject(template)) {
    return target === undefined ? cloneJsonValue(template) : target;
  }

  const nextTarget = isPlainObject(target) ? target : {};
  for (const [key, templateValue] of Object.entries(template)) {
    nextTarget[key] = deepFillMissing(nextTarget[key], templateValue);
  }
  return nextTarget;
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

export function ensureJsonTemplateAtPointer(
  root: unknown,
  segments: string[],
  template: unknown,
) {
  if (!isPlainObject(template)) {
    throw new Error("json.ensure_template 需要 object 类型的 value。");
  }

  if (segments.length === 0) {
    return deepFillMissing(root, template);
  }

  let nextRoot = root;
  let target = readOptionalJsonValue(nextRoot, segments);
  if (target === undefined) {
    nextRoot = setJsonValueAtPointer(nextRoot, segments, {});
    target = getJsonValueAtPointer(nextRoot, segments);
  }

  return setJsonValueAtPointer(nextRoot, segments, deepFillMissing(target, template));
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

export function appendJsonTextAtPointer(
  root: unknown,
  segments: string[],
  value: unknown,
  options?: {
    separator?: string;
  },
) {
  if (typeof value !== "string") {
    throw new Error("json.text_append 需要 string 类型的 value。");
  }

  const separator = typeof options?.separator === "string" ? options.separator : "";
  const currentValue = readOptionalJsonValue(root, segments);
  if (currentValue === undefined) {
    return setJsonValueAtPointer(root, segments, value);
  }
  if (typeof currentValue !== "string") {
    throw new Error("json.text_append 目标节点必须是字符串。");
  }

  const nextValue = currentValue ? `${currentValue}${separator}${value}` : value;
  return setJsonValueAtPointer(root, segments, nextValue);
}

export function appendJsonHistoryAtPointer(
  root: unknown,
  segments: string[],
  value: unknown,
  options?: {
    limit?: number;
    timestamp?: string;
    timestampField?: string;
  },
) {
  const timestampField = options?.timestampField?.trim() || "updatedAt";
  const timestamp = options?.timestamp ?? new Date().toISOString();
  const nextValue =
    isPlainObject(value) && !(timestampField in value)
      ? { ...value, [timestampField]: timestamp }
      : cloneJsonValue(value);

  const nextRoot = appendJsonValueAtPointer(root, segments, nextValue);
  const target = getJsonValueAtPointer(nextRoot, segments);
  if (!Array.isArray(target)) {
    throw new Error("json.history_append 目标节点必须是数组。");
  }

  const limit = typeof options?.limit === "number" ? Math.trunc(options.limit) : undefined;
  if (limit && limit > 0 && target.length > limit) {
    target.splice(0, target.length - limit);
  }
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

function applyAddLikePatch(root: unknown, segments: string[], value: unknown) {
  const parentSegments = segments.slice(0, -1);
  const lastSegment = segments[segments.length - 1];
  const parent =
    parentSegments.length === 0 ? root : readOptionalJsonValue(root, parentSegments);
  if (Array.isArray(parent) && lastSegment === "-") {
    parent.push(cloneJsonValue(value));
    return root;
  }
  return setJsonValueAtPointer(root, segments, value);
}

function readPatchedValue(root: unknown, segments: string[]) {
  const lastSegment = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  if (lastSegment === "-") {
    const parent = getJsonValueAtPointer(root, parentSegments);
    if (!Array.isArray(parent) || parent.length === 0) {
      throw new Error("json.patch 追加数组项后未找到结果值。");
    }
    return cloneJsonValue(parent[parent.length - 1]);
  }
  return cloneJsonValue(getJsonValueAtPointer(root, segments));
}

export function applyJsonPatch(root: unknown, operations: JsonPatchOperation[]) {
  let nextRoot = root;
  const results = operations.map((operation, index) => {
    const op = operation.op;
    const path = normalizePatchPointer(
      operation.path,
      `json.patch 第 ${index + 1} 项`,
    );
    const segments = parseJsonPointer(path);

    if (op === "remove") {
      nextRoot = deleteJsonValueAtPointer(nextRoot, segments);
      return { op, path };
    }

    if (op === "test") {
      const currentValue = cloneJsonValue(getJsonValueAtPointer(nextRoot, segments));
      const expectedValue = cloneJsonValue(operation.value);
      if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) {
        throw new Error(`json.patch 第 ${index + 1} 项 test 失败：${path}`);
      }
      return { op, path, value: currentValue };
    }

      if (op === "copy" || op === "move") {
      const from = normalizePatchPointer(
        operation.from ?? "",
        `json.patch 第 ${index + 1} 项`,
      );
      const movedValue = cloneJsonValue(
        getJsonValueAtPointer(nextRoot, parseJsonPointer(from)),
      );
      if (op === "move") {
        nextRoot = deleteJsonValueAtPointer(nextRoot, parseJsonPointer(from));
      }
      nextRoot = applyAddLikePatch(nextRoot, segments, movedValue);
      return { from, op, path, value: readPatchedValue(nextRoot, segments) };
    }

    if (operation.value === undefined) {
      throw new Error(`json.patch 第 ${index + 1} 项 ${op} 需要提供 value。`);
    }

    nextRoot =
      op === "add"
        ? applyAddLikePatch(nextRoot, segments, operation.value)
        : setJsonValueAtPointer(nextRoot, segments, operation.value);
    return { op, path, value: readPatchedValue(nextRoot, segments) };
  });

  return { operations: results, root: nextRoot };
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
