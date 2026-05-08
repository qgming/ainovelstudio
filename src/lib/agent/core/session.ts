import type { AgentPart } from "../types";
import type { AgentEventListener, AgentSessionEvent } from "./events";
import { createAsyncQueue } from "./partQueue";

export type QueueMode = "all" | "one-at-a-time";
export type CompactionReason = "manual" | "threshold" | "overflow";

export type CompactionResult = {
  summary: string;
  tokensBefore: number;
  firstKeptMessageId?: string | null;
  modelId?: string | null;
};

export type CompactionRunner = (options: {
  abortSignal: AbortSignal;
  reason: CompactionReason;
}) => Promise<CompactionResult | null>;

export type RunPromptOptions = {
  abortSignal: AbortSignal;
  emit: (event: AgentSessionEvent) => void;
  prompt: string;
  takeFollowUpMessages: () => string[];
  takeSteeringMessages: () => string[];
};

export type WritingAgentSessionConfig = {
  abortController?: AbortController;
  compact?: CompactionRunner;
  followUpMode?: QueueMode;
  runPrompt: (options: RunPromptOptions) => AsyncGenerator<AgentPart>;
  steeringMode?: QueueMode;
};

export class WritingAgentSession {
  private abortController: AbortController | null = null;
  private followUpMessages: string[] = [];
  private listeners: AgentEventListener[] = [];
  private runPromise: Promise<void> | null = null;
  private steeringMessages: string[] = [];

  constructor(private readonly config: WritingAgentSessionConfig) {}

  get isStreaming() {
    return this.runPromise !== null;
  }

  subscribe(listener: AgentEventListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  prompt(text: string): AsyncGenerator<AgentPart> {
    if (this.isStreaming) {
      void this.steer(text);
      const empty = createAsyncQueue<AgentPart>();
      empty.close();
      return empty.stream();
    }

    const output = createAsyncQueue<AgentPart>();
    this.abortController = this.config.abortController ?? new AbortController();
    const options = this.createRunOptions(text);
    this.runPromise = this.drainPrompt(options, output);
    return output.stream();
  }

  async steer(text: string) {
    this.steeringMessages.push(text);
    this.emitQueueUpdate();
  }

  async followUp(text: string) {
    this.followUpMessages.push(text);
    this.emitQueueUpdate();
  }

  abort(reason = "aborted") {
    this.abortController?.abort(reason);
  }

  async waitForIdle() {
    await this.runPromise;
  }

  async compact(reason: CompactionReason = "manual") {
    const runner = this.config.compact;
    const abortController = new AbortController();
    this.emit({ type: "compaction_start", reason });
    if (!runner) {
      this.emit({ type: "compaction_end", aborted: false, reason });
      return null;
    }

    try {
      const result = await runner({ abortSignal: abortController.signal, reason });
      this.emit({
        type: "compaction_end",
        aborted: false,
        reason,
        summary: result?.summary,
      });
      return result;
    } catch (error) {
      const aborted = abortController.signal.aborted;
      this.emit({
        type: "compaction_end",
        aborted,
        errorMessage: aborted ? undefined : getErrorMessage(error),
        reason,
      });
      throw error;
    }
  }

  private createRunOptions(prompt: string): RunPromptOptions {
    return {
      abortSignal: this.abortController!.signal,
      emit: (event) => this.emit(event),
      prompt,
      takeFollowUpMessages: () => this.takeFollowUpMessages(),
      takeSteeringMessages: () => this.takeSteeringMessages(),
    };
  }

  private async drainPrompt(options: RunPromptOptions, output: ReturnType<typeof createAsyncQueue<AgentPart>>) {
    try {
      for await (const part of this.config.runPrompt(options)) {
        output.push(part);
      }
      output.close();
    } catch (error) {
      output.close(error);
    } finally {
      this.abortController = null;
      this.runPromise = null;
    }
  }

  private takeSteeringMessages() {
    return this.takeMessages("steering");
  }

  private takeFollowUpMessages() {
    return this.takeMessages("followUp");
  }

  private takeMessages(kind: "followUp" | "steering") {
    const mode = kind === "steering" ? this.config.steeringMode : this.config.followUpMode;
    const source = kind === "steering" ? this.steeringMessages : this.followUpMessages;
    const count = mode === "all" ? source.length : Math.min(source.length, 1);
    const messages = source.splice(0, count);
    if (messages.length > 0) this.emitQueueUpdate();
    return messages;
  }

  private emit(event: AgentSessionEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitQueueUpdate() {
    this.emit({
      type: "queue_update",
      followUp: [...this.followUpMessages],
      steering: [...this.steeringMessages],
    });
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "压缩上下文失败。";
}
