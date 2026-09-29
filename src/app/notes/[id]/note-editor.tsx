"use client";

import { Eye, RotateCcw, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyLinkButton } from "@/components/copy-link-button";
import { MAX_IMAGE_BYTES } from "@/core";
import {
  enqueueDraft,
  flushQueue,
  getBrowserDraftStore,
  sendQueuedDraft,
} from "@/lib/offline-queue";
import { publishAction, restoreAction, saveDraftAction } from "./actions";

interface VersionItem {
  versionNumber: number;
  message: string | null;
  authorType: string;
  createdAt: string;
}

interface NoteEditorProps {
  noteId: string;
  shareToken?: string | null;
  isOwner?: boolean;
  initialTitle: string;
  initialContent: string;
  initialRevision: number;
  visibility: string;
  shareUrl: string | null;
  publishedVersionNumber: number | null;
  versions: VersionItem[];
}

interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface VersionDiff {
  from_version: number | null;
  to_version: number | null;
  to_draft: boolean;
  title_diff: { hunks: DiffHunk[]; added: number; removed: number; empty: boolean };
  content_diff: { hunks: DiffHunk[]; added: number; removed: number; empty: boolean };
}

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const textareaClass =
  "w-full rounded-md border border-zinc-300 bg-white p-3 font-mono text-sm leading-6 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const primaryButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const secondaryButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

export function NoteEditor(props: NoteEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [content, setContent] = useState(props.initialContent);
  const [revision, setRevision] = useState(props.initialRevision);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [diffVersion, setDiffVersion] = useState<number | null>(null);
  const [diffMode, setDiffMode] = useState<"inline" | "side">("inline");
  const [diffData, setDiffData] = useState<VersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [codeLang, setCodeLang] = useState("ts");
  const [showToc, setShowToc] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef(props.initialRevision);
  // Double-submit guard: server actions have no Idempotency-Key header, so an
  // in-flight flag plus the disabled Save button is what stops a second tap
  // from issuing a second write. Queued offline flushes go through PATCH with
  // a stable Idempotency-Key instead (see sendQueuedDraft).
  const saveInFlight = useRef(false);
  const lastSavedRef = useRef({ title: props.initialTitle, content: props.initialContent });
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function queueOffline(snapshot: { title: string; content: string }) {
    try {
      await enqueueDraft(getBrowserDraftStore(), {
        noteId: props.noteId,
        shareToken: props.shareToken,
        title: snapshot.title,
        content: snapshot.content,
        baseRevision: revisionRef.current,
      });
      setQueued(true);
      setStatus("Offline: draft queued on this device, will sync when reconnected");
    } catch {
      setStatus("Offline: could not queue the draft on this device");
    }
  }

  async function handleSave() {
    if (saveInFlight.current) {
      return;
    }
    saveInFlight.current = true;
    setBusy(true);
    setStatus(null);
    let result: Awaited<ReturnType<typeof saveDraftAction>> | null = null;
    try {
      result = await saveDraftAction({
        noteId: props.noteId,
        shareToken: props.shareToken,
        title,
        content,
        baseRevision: revision,
      });
    } catch (error) {
      // Auth redirects must still navigate; only network failures queue offline.
      if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) {
        throw error;
      }
      result = null;
    }
    saveInFlight.current = false;
    setBusy(false);

    if (result && result.ok && result.revision !== undefined) {
      setRevision(result.revision);
      revisionRef.current = result.revision;
      lastSavedRef.current = { title, content };
      setConflict(false);
      setStatus("Draft saved");
      return;
    }
    if (result && result.conflict) {
      setConflict(true);
      setStatus("Not saved: this note changed elsewhere");
      return;
    }
    // No response at all (or a thrown redirect/network failure) while the
    // browser reports offline: keep the airplane-mode draft on this device.
    if (!result && typeof navigator !== "undefined" && !navigator.onLine) {
      await queueOffline({ title, content });
      return;
    }
    setStatus(result?.message ?? "Save failed");
  }

  async function handlePublish() {
    setBusy(true);
    setStatus(null);
    const result = await publishAction({
      noteId: props.noteId,
      shareToken: props.shareToken,
      message: message.trim() || undefined,
    });
    setBusy(false);

    if (result.ok) {
      setMessage("");
      setStatus("Published");
      router.refresh();
      return;
    }
    setStatus(result.message ?? "Publish failed");
  }

  async function handleRestore(versionNumber: number) {
    setBusy(true);
    setStatus(null);
    const result = await restoreAction({
      noteId: props.noteId,
      shareToken: props.shareToken,
      versionNumber,
    });
    setBusy(false);

    if (result.ok && result.revision !== undefined) {
      setRevision(result.revision);
      setStatus(`Restored version ${versionNumber}`);
      router.refresh();
      return;
    }
    setStatus(result.message ?? "Restore failed");
  }

  async function openDiff(versionNumber: number) {
    setDiffVersion(versionNumber);
    setDiffData(null);
    setDiffError(null);
    setDiffLoading(true);
    try {
      const params = new URLSearchParams({ to: "draft" });
      if (props.shareToken) {
        params.set("share_token", props.shareToken);
      }
      const res = await fetch(
        `/api/v1/notes/${props.noteId}/versions/${versionNumber}/diff?${params.toString()}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail =
          body && typeof body.detail === "string" ? body.detail : `Diff failed (${res.status})`;
        setDiffError(detail);
        return;
      }
      const body = (await res.json()) as VersionDiff;
      setDiffData(body);
    } catch {
      setDiffError("Could not load the diff");
    } finally {
      setDiffLoading(false);
    }
  }

  async function handleConfirmRestore() {
    if (diffVersion === null) {
      return;
    }
    await handleRestore(diffVersion);
    setDiffVersion(null);
    setDiffData(null);
  }

  const headings = useMemo(
    () =>
      content.split("\n").flatMap((line, index) => {
        const match = /^(#{1,6})\s+(.*)$/.exec(line);
        return match ? [{ depth: match[1].length, text: match[2], line: index }] : [];
      }),
    [content],
  );

  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    if (!el) {
      setContent((current) => `${current}${snippet}`);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = `${content.slice(0, start)}${snippet}${content.slice(end)}`;
    setContent(next);
    const caret = start + snippet.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function gotoLine(line: number) {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    const offset = content.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
    el.focus();
    el.setSelectionRange(offset, offset);
  }

  async function uploadImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setStatus("Only image files can be uploaded");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus("Image must be 5 MiB or smaller");
      return;
    }
    setUploading(true);
    setStatus(null);
    try {
      const csrf = (await fetch("/api/v1/csrf").then((res) => res.json())) as { token: string };
      const form = new FormData();
      form.append("file", file);
      if (props.shareToken) {
        form.append("share_token", props.shareToken);
      }
      const res = await fetch(`/api/v1/notes/${props.noteId}/images`, {
        method: "POST",
        headers: { "x-csrf-token": csrf.token },
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        setStatus(body?.detail ?? "Image upload failed");
        return;
      }
      const body = (await res.json()) as { url: string };
      insertAtCursor(`![${file.name}](${body.url})`);
      setStatus("Image uploaded");
    } catch {
      setStatus("Image upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Autosave: debounce edits into the same draft path as manual save, so the
  // 409 conflict handling is identical no matter which blocks were added.
  useEffect(() => {
    if (title === lastSavedRef.current.title && content === lastSavedRef.current.content) {
      return;
    }
    if (conflict) {
      return;
    }
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
    }
    autoTimer.current = setTimeout(async () => {
      const snapshot = { title, content };
      const result = await saveDraftAction({
        noteId: props.noteId,
        shareToken: props.shareToken,
        title: snapshot.title,
        content: snapshot.content,
        baseRevision: revisionRef.current,
      });
      if (result.ok && result.revision !== undefined) {
        revisionRef.current = result.revision;
        setRevision(result.revision);
        lastSavedRef.current = snapshot;
        setStatus("Autosaved");
        return;
      }
      if (result.conflict) {
        setConflict(true);
        setStatus("Not saved: this note changed elsewhere");
      }
    }, 1500);
    return () => {
      if (autoTimer.current) {
        clearTimeout(autoTimer.current);
      }
    };
  }, [title, content, conflict, props.noteId, props.shareToken]);

  // Flush queued offline drafts on mount and on reconnect. Synced entries
  // apply through the idempotent PATCH path; 409s reuse the conflict banner.
  useEffect(() => {
    let cancelled = false;

    async function flush() {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return;
      }
      let summary: Awaited<ReturnType<typeof flushQueue>> | null = null;
      try {
        summary = await flushQueue(getBrowserDraftStore(), sendQueuedDraft);
      } catch {
        return;
      }
      if (cancelled || !summary) {
        return;
      }
      const remaining = await getBrowserDraftStore()
        .list()
        .catch(() => []);
      setQueued(remaining.length > 0);
      if (summary.conflicts.includes(props.noteId)) {
        setConflict(true);
        setStatus("Not saved: this note changed elsewhere");
        return;
      }
      const synced = summary.synced.includes(props.noteId);
      if (synced) {
        // The server is the source of truth after a flush; reload the draft so
        // the revision and content match what actually applied.
        window.location.reload();
      }
    }

    void flush();
    window.addEventListener("online", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("online", flush);
    };
  }, [props.noteId]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title || "Untitled"}</h1>
            <p className="text-xs text-zinc-500">
              {props.visibility} · r{revision} ·{" "}
              {props.publishedVersionNumber
                ? `published v${props.publishedVersionNumber}`
                : "not published"}
            </p>
            {props.isOwner === false ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Editing via a shared link
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Publish message"
              aria-label="Publish message"
              className={`${inputClass} w-44`}
            />
            <button
              type="button"
              onClick={handlePublish}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Publish
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className={primaryButtonClass}
            >
              <Save className="h-4 w-4" />
              Save draft
            </button>
          </div>
        </div>

        {conflict ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span>This note changed elsewhere and your edits were not saved.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-medium underline"
            >
              Reload
            </button>
          </div>
        ) : null}

        {queued && !conflict ? (
          <p className="rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            Offline draft queued on this device. It will sync automatically when you reconnect.
          </p>
        ) : null}

        {status ? <p className="text-sm text-zinc-500">{status}</p> : null}

        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Editing tools"
        >
          <button
            type="button"
            onClick={() => insertAtCursor("- [ ] ")}
            disabled={busy || uploading}
            title="Insert task list item"
            className={secondaryButtonClass}
          >
            Task
          </button>
          <button
            type="button"
            onClick={() =>
              insertAtCursor("\n| Header | Header |\n| --- | --- |\n| Cell | Cell |\n")
            }
            disabled={busy || uploading}
            title="Insert table"
            className={secondaryButtonClass}
          >
            Table
          </button>
          <label className="sr-only" htmlFor="code-lang">
            Code block language
          </label>
          <select
            id="code-lang"
            value={codeLang}
            onChange={(event) => setCodeLang(event.target.value)}
            disabled={busy || uploading}
            title="Code block language"
            className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {["ts", "js", "py", "go", "rs", "sh", "sql", "json", "md", "text"].map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              insertAtCursor(`\n\u0060\u0060\u0060${codeLang}\n\n\u0060\u0060\u0060\n`)
            }
            disabled={busy || uploading}
            title="Insert code block"
            className={secondaryButtonClass}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || uploading}
            title="Upload image"
            className={secondaryButtonClass}
          >
            {uploading ? "Uploading…" : "Image"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            aria-label="Upload image"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void uploadImage(file);
              }
            }}
          />
          <button
            type="button"
            onClick={() => setShowToc((value) => !value)}
            disabled={busy}
            title="Toggle table of contents"
            aria-pressed={showToc}
            className={secondaryButtonClass}
          >
            TOC{headings.length > 0 ? ` (${headings.length})` : ""}
          </button>
        </div>

        {showToc ? (
          <nav
            aria-label="Table of contents"
            className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            {headings.length === 0 ? (
              <p className="text-sm text-zinc-500">No headings yet. Start a line with #.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {headings.map((heading) => (
                  <li key={heading.line}>
                    <button
                      type="button"
                      onClick={() => gotoLine(heading.line)}
                      className="truncate text-left text-sm text-zinc-600 hover:underline dark:text-zinc-300"
                      style={{ marginLeft: (heading.depth - 1) * 12 }}
                    >
                      {heading.text || "(empty heading)"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        ) : null}

        <div className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="note-title">
            Title
          </label>
          <input
            id="note-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            className={inputClass}
          />
          <label className="sr-only" htmlFor="note-content">
            Content
          </label>
          <textarea
            id="note-content"
            ref={textareaRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files?.[0];
              if (file) {
                void uploadImage(file);
              }
            }}
            rows={22}
            placeholder="Write in markdown. Drag an image here to upload it."
            className={textareaClass}
          />
        </div>

        {props.shareUrl ? (
          <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Share link</h2>
              <CopyLinkButton url={props.shareUrl} />
            </div>
            <p className="truncate font-mono text-xs text-zinc-500">{props.shareUrl}</p>
          </section>
        ) : null}

        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="text-sm font-medium">Version history</h2>
          {props.versions.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing published yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {props.versions.map((version) => (
                <li
                  key={version.versionNumber}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      v{version.versionNumber}
                      {version.message ? ` · ${version.message}` : ""}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {version.authorType === "ai" ? "AI" : "Human"} ·{" "}
                      {version.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openDiff(version.versionNumber)}
                      disabled={busy}
                      title={`Diff v${version.versionNumber} against draft`}
                      aria-label={`Diff v${version.versionNumber} against draft`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDiff(version.versionNumber)}
                      disabled={busy}
                      title={`Restore v${version.versionNumber}`}
                      aria-label={`Restore v${version.versionNumber}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {diffVersion !== null ? (
          <section
            aria-label={`Diff of version ${diffVersion}`}
            className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">
                Restore preview: v{diffVersion} against current draft
              </h2>
              <div className="flex items-center gap-1">
                <div
                  role="group"
                  aria-label="Diff view"
                  className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
                >
                  <button
                    type="button"
                    onClick={() => setDiffMode("inline")}
                    aria-pressed={diffMode === "inline"}
                    className={`h-7 px-3 text-xs font-medium ${diffMode === "inline" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300"}`}
                  >
                    Inline
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiffMode("side")}
                    aria-pressed={diffMode === "side"}
                    className={`h-7 px-3 text-xs font-medium ${diffMode === "side" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300"}`}
                  >
                    Side by side
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDiffVersion(null);
                    setDiffData(null);
                    setDiffError(null);
                  }}
                  aria-label="Close diff"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {diffLoading ? <p className="text-sm text-zinc-500">Loading diff…</p> : null}
            {diffError ? <p className="text-sm text-red-600">{diffError}</p> : null}
            {diffData && diffData.title_diff.empty && diffData.content_diff.empty ? (
              <p className="text-sm text-zinc-500">
                No differences: this version matches the current draft.
              </p>
            ) : null}
            {diffData && (!diffData.title_diff.empty || !diffData.content_diff.empty) ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-zinc-500">
                  +{diffData.content_diff.added + diffData.title_diff.added} −
                  {diffData.content_diff.removed + diffData.title_diff.removed} · markdown source
                  shown, formatting preserved
                </p>
                {!diffData.title_diff.empty ? (
                  <div className="flex flex-col gap-1">
                    <h3 className="text-xs font-medium text-zinc-500">Title</h3>
                    <DiffView hunks={diffData.title_diff.hunks} mode={diffMode} />
                  </div>
                ) : null}
                {!diffData.content_diff.empty ? (
                  <div className="flex flex-col gap-1">
                    <h3 className="text-xs font-medium text-zinc-500">Content</h3>
                    <DiffView hunks={diffData.content_diff.hunks} mode={diffMode} />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmRestore}
                    disabled={busy || diffLoading}
                    className={primaryButtonClass}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Confirm restore v{diffVersion}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDiffVersion(null);
                      setDiffData(null);
                      setDiffError(null);
                    }}
                    disabled={busy}
                    className={secondaryButtonClass}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function rowClass(type: DiffLine["type"]): string {
  if (type === "add") {
    return "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200";
  }
  if (type === "del") {
    return "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200";
  }
  return "text-zinc-600 dark:text-zinc-400";
}

function DiffView({ hunks, mode }: { hunks: DiffHunk[]; mode: "inline" | "side" }) {
  if (hunks.length === 0) {
    return null;
  }
  if (mode === "side") {
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-zinc-200 font-mono text-xs dark:border-zinc-800">
        {hunks.map((hunk, hi) => (
          <div key={hi} className="col-span-2 grid grid-cols-2 gap-px bg-zinc-200 dark:bg-zinc-800">
            {hunk.lines.map((line, li) => (
              <div
                key={li}
                className="col-span-2 grid grid-cols-2 gap-px bg-zinc-200 dark:bg-zinc-800"
              >
                <div
                  className={`whitespace-pre-wrap break-words px-2 py-1 ${rowClass(line.type === "add" ? "same" : line.type)}`}
                >
                  {line.type === "add"
                    ? ""
                    : `${line.oldLineNumber ?? ""} ${line.type === "del" ? "− " : "  "}${line.text}`}
                </div>
                <div
                  className={`whitespace-pre-wrap break-words px-2 py-1 ${rowClass(line.type === "del" ? "same" : line.type)}`}
                >
                  {line.type === "del"
                    ? ""
                    : `${line.newLineNumber ?? ""} ${line.type === "add" ? "+ " : "  "}${line.text}`}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 font-mono text-xs dark:border-zinc-800">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
          <p className="bg-zinc-100 px-2 py-1 text-zinc-500 dark:bg-zinc-800">
            @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
          </p>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={`whitespace-pre-wrap break-words px-2 py-1 ${rowClass(line.type)}`}
            >
              {line.type === "add"
                ? `+ ${line.text}`
                : line.type === "del"
                  ? `− ${line.text}`
                  : `  ${line.text}`}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
