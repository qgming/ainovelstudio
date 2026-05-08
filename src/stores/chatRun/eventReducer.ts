import type { AgentSessionEvent } from "../../lib/agent/session";

export function queuePatchFromEvent(event: AgentSessionEvent) {
  if (event.type !== "queue_update") return null;
  return {
    queuedFollowUpMessages: [...event.followUp],
    queuedSteeringMessages: [...event.steering],
  };
}

export function compactionPatchFromEvent(event: AgentSessionEvent) {
  if (event.type === "compaction_start") {
    return { isCompacting: true };
  }
  if (event.type === "compaction_end") {
    return { isCompacting: false };
  }
  return null;
}
