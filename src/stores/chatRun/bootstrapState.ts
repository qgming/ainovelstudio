import { derivePlanningState } from "../../lib/agent/planning";
import { entriesToMessages, getCompactionCount, getLatestCompactionEntry } from "../../lib/chat/entries";
import {
  buildInitialRun,
  buildRun,
  normalizeRecoveredMessages,
  normalizeRecoveredStatus,
} from "../../lib/chat/sessionRuntime";
import type { ChatBootstrap } from "../../lib/chat/types";
import type { ChatRunStoreState } from "./helpers";

export function applyBootstrap(
  state: ChatRunStoreState,
  bootstrap: ChatBootstrap,
): Partial<ChatRunStoreState> {
  const normalizedSessions = bootstrap.sessions.map((session) => ({
    ...session,
    status: normalizeRecoveredStatus(session.status),
  }));
  const validIds = new Set(normalizedSessions.map((session) => session.id));
  const nextMessagesBySession = filterRecord(state.messagesBySession, validIds);
  const nextEntriesBySession = filterRecord(state.entriesBySession, validIds);
  const nextDraftsBySession = filterRecord(state.draftsBySession, validIds);
  const nextAutopilotGoalsBySession = filterRecord(state.autopilotGoalsBySession, validIds);

  if (bootstrap.activeSessionId) {
    nextEntriesBySession[bootstrap.activeSessionId] = bootstrap.activeSessionEntries;
    nextMessagesBySession[bootstrap.activeSessionId] = normalizeRecoveredMessages(
      entriesToMessages(bootstrap.activeSessionEntries),
    );
    nextDraftsBySession[bootstrap.activeSessionId] = bootstrap.activeSessionDraft;
  }

  const activeMessages = bootstrap.activeSessionId
    ? nextMessagesBySession[bootstrap.activeSessionId] ?? []
    : [];
  const activeEntries = bootstrap.activeSessionId
    ? nextEntriesBySession[bootstrap.activeSessionId] ?? []
    : [];
  const activeSummary = bootstrap.activeSessionId
    ? normalizedSessions.find((session) => session.id === bootstrap.activeSessionId) ?? null
    : null;
  const latestCompaction = getLatestCompactionEntry(activeEntries);

  return {
    activeSessionId: bootstrap.activeSessionId,
    autopilotGoalsBySession: nextAutopilotGoalsBySession,
    currentBookId: bootstrap.bookId ?? state.currentBookId,
    draftsBySession: nextDraftsBySession,
    errorMessage: null,
    entriesBySession: nextEntriesBySession,
    input: bootstrap.activeSessionId ? nextDraftsBySession[bootstrap.activeSessionId] ?? "" : "",
    inflightToolRequestIds: [],
    pendingAsk: null,
    queuedFollowUpMessages: [],
    queuedSteeringMessages: [],
    compactionCount: getCompactionCount(activeEntries),
    isCompacting: false,
    latestCompactionAt: latestCompaction?.createdAt ?? null,
    latestCompactionTokensBefore: latestCompaction?.payload.tokensBefore ?? null,
    isHydrated: true,
    messagesBySession: nextMessagesBySession,
    planningState: derivePlanningState(activeMessages),
    run: activeSummary
      ? buildRun(activeSummary.id, activeSummary.title, activeSummary.status, activeMessages)
      : buildInitialRun(),
    sessions: normalizedSessions,
    status: "ready",
  };
}

function filterRecord<T>(record: Record<string, T>, validIds: Set<string>) {
  return Object.fromEntries(
    Object.entries(record).filter(([sessionId]) => validIds.has(sessionId)),
  ) as Record<string, T>;
}
