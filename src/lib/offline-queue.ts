"use client";

/**
 * Offline draft queue for issue #84 (Mobile PWA and offline drafts).
 *
 * Airplane-mode flow: edits made while offline are coalesced per note into a
 * single IndexedDB entry that survives reloads. Each entry carries a stable
 * Idempotency-Key, so when connectivity returns the queue flushes through the
 * same PATCH /api/v1/notes/[id] path as an online save: a retried flush
 * replays instead of double-applying, and a 409 reuses the editor's existing
 * conflict reconcile UI.
 */

export interface QueuedDraft {
  /** Stable Idempotency-Key for this note until it syncs. */
  key: string;
  noteId: string;
  title: string;
  content: string;
  baseRevision: number;
  shareToken: string | null;
  queuedAt: number;
  attempts: number;
}

export interface EnqueueInput {
  noteId: string;
  title: string;
  content: string;
  baseRevision: number;
  shareToken?: string | null;
  /** Test/SSR override; the browser generates one with crypto.randomUUID(). */
  key?: string;
}

export interface DraftStore {
  list(): Promise<QueuedDraft[]>;
  put(entry: QueuedDraft): Promise<void>;
  remove(noteId: string): Promise<void>;
  clear(): Promise<void>;
}

export type SyncStatus = "synced" | "conflict" | "offline" | "error";

export interface SyncResult {
  status: SyncStatus;
  revision?: number;
}

export interface FlushSummary {
  synced: string[];
  conflicts: string[];
  /** Entries left in the queue (still offline or errored). */
  pending: string[];
}

export const OFFLINE_QUEUE_EVENT = "memorynotes:offline-queue-change";

export function emitQueueChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
  }
}

function newKey(provided?: string): string {
  if (provided) {
    return provided;
  }
  const cryptoRef =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** In-memory store: used by tests and as a fallback when storage is unavailable. */
export function createMemoryDraftStore(): DraftStore {
  const entries = new Map<string, QueuedDraft>();
  return {
    async list() {
      return [...entries.values()].sort((a, b) => a.queuedAt - b.queuedAt);
    },
    async put(entry) {
      entries.set(entry.noteId, entry);
    },
    async remove(noteId) {
      entries.delete(noteId);
    },
    async clear() {
      entries.clear();
    },
  };
}

const LOCAL_STORAGE_KEY = "memorynotes:offline-drafts:v1";

function readLocalStorage(): QueuedDraft[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as QueuedDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createLocalStorageDraftStore(): DraftStore {
  return {
    async list() {
      return readLocalStorage().sort((a, b) => a.queuedAt - b.queuedAt);
    },
    async put(entry) {
      const rest = readLocalStorage().filter((item) => item.noteId !== entry.noteId);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([...rest, entry]));
    },
    async remove(noteId) {
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(readLocalStorage().filter((item) => item.noteId !== noteId)),
      );
    },
    async clear() {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    },
  };
}

const IDB_NAME = "memorynotes-offline";
const IDB_STORE = "drafts";

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE, { keyPath: "noteId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function createIndexedDbDraftStore(): DraftStore {
  async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await openDraftDb();
    try {
      const tx = db.transaction(IDB_STORE, mode);
      const result = await new Promise<T>((resolve, reject) => {
        const request = run(tx.objectStore(IDB_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      });
      return result;
    } finally {
      db.close();
    }
  }

  return {
    async list() {
      const rows = await withStore("readonly", (store) => store.getAll());
      const entries = (rows ?? []) as QueuedDraft[];
      return entries.sort((a, b) => a.queuedAt - b.queuedAt);
    },
    async put(entry) {
      await withStore("readwrite", (store) => store.put(entry));
    },
    async remove(noteId) {
      await withStore("readwrite", (store) => store.delete(noteId));
    },
    async clear() {
      await withStore("readwrite", (store) => store.clear());
    },
  };
}

/**
 * Browser store: IndexedDB when available (survives reloads), localStorage
 * fallback for private-mode browsers, in-memory for SSR/prerender.
 */
export function getBrowserDraftStore(): DraftStore {
  if (typeof indexedDB !== "undefined") {
    try {
      return createIndexedDbDraftStore();
    } catch {
      // Fall through to localStorage.
    }
  }
  if (typeof localStorage !== "undefined") {
    return createLocalStorageDraftStore();
  }
  return createMemoryDraftStore();
}

/**
 * Queue a draft for later sync. Multiple offline edits to the same note
 * collapse into ONE entry that keeps the first idempotency key, so the queued
 * work syncs exactly once no matter how many keystrokes happened offline.
 */
export async function enqueueDraft(store: DraftStore, input: EnqueueInput): Promise<QueuedDraft> {
  const existing = (await store.list()).find((entry) => entry.noteId === input.noteId);
  if (existing) {
    const merged: QueuedDraft = {
      ...existing,
      title: input.title,
      content: input.content,
      baseRevision: input.baseRevision,
    };
    await store.put(merged);
    emitQueueChange();
    return merged;
  }
  const entry: QueuedDraft = {
    key: newKey(input.key),
    noteId: input.noteId,
    title: input.title,
    content: input.content,
    baseRevision: input.baseRevision,
    shareToken: input.shareToken ?? null,
    queuedAt: Date.now(),
    attempts: 0,
  };
  await store.put(entry);
  emitQueueChange();
  return entry;
}

/** Build the PATCH request the queue flush sends for one entry. */
export function buildDraftSyncRequest(entry: QueuedDraft): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
} {
  return {
    url: `/api/v1/notes/${entry.noteId}`,
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "idempotency-key": entry.key,
    },
    body: JSON.stringify({
      title: entry.title,
      content: entry.content,
      base_revision: entry.baseRevision,
      ...(entry.shareToken ? { share_token: entry.shareToken } : {}),
    }),
  };
}

/**
 * Flush the queue in order. Each entry is sent at most once per flush; synced
 * and conflicted entries leave the queue (conflicts surface through the
 * editor's 409 reconcile path), while offline/errored entries stay queued.
 */
export async function flushQueue(
  store: DraftStore,
  sender: (entry: QueuedDraft) => Promise<SyncResult>,
): Promise<FlushSummary> {
  const summary: FlushSummary = { synced: [], conflicts: [], pending: [] };
  const entries = await store.list();
  for (const entry of entries) {
    let result: SyncResult;
    try {
      result = await sender(entry);
    } catch {
      result = { status: "offline" };
    }
    if (result.status === "synced") {
      await store.remove(entry.noteId);
      summary.synced.push(entry.noteId);
    } else if (result.status === "conflict") {
      await store.remove(entry.noteId);
      summary.conflicts.push(entry.noteId);
    } else {
      if (result.status === "offline") {
        await store.put({ ...entry, attempts: entry.attempts + 1 });
      }
      summary.pending.push(entry.noteId);
    }
  }
  if (summary.synced.length > 0 || summary.conflicts.length > 0) {
    emitQueueChange();
  }
  return summary;
}

/**
 * Browser sender: PATCH through the idempotent notes API. Cookie sessions need
 * the double-submit CSRF token; bearer auth is exempt server-side.
 */
export async function sendQueuedDraft(entry: QueuedDraft): Promise<SyncResult> {
  const request = buildDraftSyncRequest(entry);
  let csrf: string | null = null;
  try {
    const res = await fetch("/api/v1/csrf");
    if (res.ok) {
      csrf = ((await res.json()) as { token?: string }).token ?? null;
    }
  } catch {
    return { status: "offline" };
  }
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
      body: request.body,
    });
  } catch {
    return { status: "offline" };
  }
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as {
      draft?: { revision?: number };
    } | null;
    return { status: "synced", revision: body?.draft?.revision };
  }
  if (response.status === 409) {
    return { status: "conflict" };
  }
  if (!navigator.onLine || response.status === 0) {
    return { status: "offline" };
  }
  if (response.status >= 500) {
    return { status: "offline" };
  }
  return { status: "error" };
}
