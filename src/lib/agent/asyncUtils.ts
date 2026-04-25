/**
 * Agent 运行时通用异步原语：abort 信号封装与工具请求 ID 生成。
 * 之前散落在 session.ts 顶部，被子任务执行与主回合共用。
 */

/** 构造统一的 AbortError，与 DOM 行为保持一致。 */
export function createAbortError(): DOMException {
  return new DOMException("Agent execution aborted.", "AbortError");
}

/** 已 abort 时立即抛错。 */
export function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }
}

/** 把异步任务包进 abort 监听：abort 触发时 reject。 */
export async function withAbort<T>(
  abortSignal: AbortSignal | undefined,
  task: () => Promise<T>,
): Promise<T> {
  if (!abortSignal) {
    return task();
  }
  if (abortSignal.aborted) {
    throw createAbortError();
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createAbortError());
    abortSignal.addEventListener("abort", handleAbort, { once: true });
    task()
      .then((value) => {
        abortSignal.removeEventListener("abort", handleAbort);
        resolve(value);
      })
      .catch((error) => {
        abortSignal.removeEventListener("abort", handleAbort);
        reject(error);
      });
  });
}

/** 生成工具请求的唯一 ID，用于追踪进行中的工具调用。 */
export function createToolRequestId(toolName: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tool-${toolName}-${crypto.randomUUID()}`;
  }
  return `tool-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
