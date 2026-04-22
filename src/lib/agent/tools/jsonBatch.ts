import {
  appendJsonValueAtPointer,
  cloneJsonValue,
  deleteJsonValueAtPointer,
  getJsonValueAtPointer,
  mergeJsonValueAtPointer,
  normalizeJsonAction,
  parseJsonPointer,
  setJsonValueAtPointer,
  type JsonAction,
} from "./json";

export type JsonBatchOperation = {
  action: Exclude<JsonAction, "batch" | "get">;
  pointer?: string;
  value?: unknown;
};

export type JsonBatchResult = {
  action: JsonBatchOperation["action"];
  deleted?: true;
  pointer: string;
  value?: unknown;
};

export function normalizeJsonBatchOperation(
  operation: unknown,
  index: number,
): JsonBatchOperation {
  if (!operation || typeof operation !== "object") {
    throw new Error(`json.batch 第 ${index + 1} 项操作必须是对象。`);
  }

  const record = operation as Record<string, unknown>;
  const action = normalizeJsonAction(record.action);
  if (
    action !== "append" &&
    action !== "delete" &&
    action !== "merge" &&
    action !== "set"
  ) {
    throw new Error(
      `json.batch 第 ${index + 1} 项 action 仅支持 set / merge / append / delete。`,
    );
  }

  return {
    action,
    pointer: "pointer" in record ? String(record.pointer ?? "") : undefined,
    value: record.value,
  };
}

function createValueResult(
  action: JsonBatchOperation["action"],
  pointer: string,
  root: unknown,
  segments: string[],
) {
  return {
    action,
    pointer,
    value: cloneJsonValue(getJsonValueAtPointer(root, segments)),
  };
}

export function applyJsonOperation(
  root: unknown,
  operation: JsonBatchOperation,
): { result: JsonBatchResult; root: unknown } {
  const pointer = String(operation.pointer ?? "");
  const segments = parseJsonPointer(pointer);
  const normalizedPointer = pointer || "/";

  if (operation.action !== "delete" && operation.value === undefined) {
    throw new Error(`json.${operation.action} 需要提供 value。`);
  }

  if (operation.action === "set") {
    const nextRoot = setJsonValueAtPointer(root, segments, operation.value);
    return {
      result: createValueResult(operation.action, normalizedPointer, nextRoot, segments),
      root: nextRoot,
    };
  }

  if (operation.action === "merge") {
    const nextRoot = mergeJsonValueAtPointer(root, segments, operation.value);
    return {
      result: createValueResult(operation.action, normalizedPointer, nextRoot, segments),
      root: nextRoot,
    };
  }

  if (operation.action === "append") {
    const nextRoot = appendJsonValueAtPointer(root, segments, operation.value);
    return {
      result: createValueResult(operation.action, normalizedPointer, nextRoot, segments),
      root: nextRoot,
    };
  }

  const nextRoot = deleteJsonValueAtPointer(root, segments);
  return {
    result: { action: operation.action, deleted: true, pointer: normalizedPointer },
    root: nextRoot,
  };
}

export function applyJsonOperations(
  root: unknown,
  operations: JsonBatchOperation[],
): { results: JsonBatchResult[]; root: unknown } {
  let nextRoot = root;
  const results = operations.map((operation, index) => {
    try {
      const applied = applyJsonOperation(nextRoot, operation);
      nextRoot = applied.root;
      return applied.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      throw new Error(`json.batch 第 ${index + 1} 项操作失败：${message}`);
    }
  });

  return { results, root: nextRoot };
}
