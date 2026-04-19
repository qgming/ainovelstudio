export type ClientStateSnapshot = {
  entries: Record<string, string>;
  updatedAt: number;
};

const CLIENT_STATE_UPDATED_AT_KEY = "ainovelstudio-client-state-updated-at";
const SYNCED_STORAGE_KEYS = [
  "ainovelstudio-theme",
  "ainovelstudio-book-layout",
  "ainovelstudio-book-workspace",
  "ainovelstudio-book-route-cache",
  CLIENT_STATE_UPDATED_AT_KEY,
] as const;

function canUseStorage() {
  return typeof window !== "undefined";
}

function parseStoredTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function touchClientStateUpdatedAt(timestamp = Date.now()) {
  if (!canUseStorage()) {
    return timestamp;
  }

  window.localStorage.setItem(CLIENT_STATE_UPDATED_AT_KEY, String(timestamp));
  return timestamp;
}

export function collectAppClientState(): ClientStateSnapshot {
  if (!canUseStorage()) {
    return { entries: {}, updatedAt: 0 };
  }

  const entries = Object.fromEntries(
    SYNCED_STORAGE_KEYS.flatMap((key) => {
      const value = window.localStorage.getItem(key);
      return value === null ? [] : [[key, value] as const];
    }),
  );

  return {
    entries,
    updatedAt: parseStoredTimestamp(entries[CLIENT_STATE_UPDATED_AT_KEY] ?? null),
  };
}

export function applyAppClientState(snapshot: ClientStateSnapshot) {
  if (!canUseStorage()) {
    return;
  }

  for (const key of SYNCED_STORAGE_KEYS) {
    if (!(key in snapshot.entries)) {
      window.localStorage.removeItem(key);
    }
  }

  for (const [key, value] of Object.entries(snapshot.entries)) {
    if (SYNCED_STORAGE_KEYS.includes(key as (typeof SYNCED_STORAGE_KEYS)[number])) {
      window.localStorage.setItem(key, value);
    }
  }

  if (!snapshot.entries[CLIENT_STATE_UPDATED_AT_KEY]) {
    window.localStorage.setItem(
      CLIENT_STATE_UPDATED_AT_KEY,
      String(snapshot.updatedAt || Date.now()),
    );
  }
}

export function applyAppClientStateAndReload(snapshot: ClientStateSnapshot, delayMs = 420) {
  applyAppClientState(snapshot);
  window.setTimeout(() => {
    window.location.reload();
  }, delayMs);
}
