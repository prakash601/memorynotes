"use client";

import { RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyLinkButton } from "@/components/copy-link-button";
import { publishAction, restoreAction, saveDraftAction } from "./actions";

interface VersionItem {
  versionNumber: number;
  message: string | null;
  authorType: string;
  createdAt: string;
}

interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  initialContent: string;
  initialRevision: number;
  visibility: string;
  shareUrl: string | null;
  publishedVersionNumber: number | null;
  versions: VersionItem[];
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

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    const result = await saveDraftAction({
      noteId: props.noteId,
      title,
      content,
      baseRevision: revision,
    });
    setBusy(false);

    if (result.ok && result.revision !== undefined) {
      setRevision(result.revision);
      setConflict(false);
      setStatus("Draft saved");
      return;
    }
    if (result.conflict) {
      setConflict(true);
      setStatus("Not saved: this note changed elsewhere");
      return;
    }
    setStatus(result.message ?? "Save failed");
  }

  async function handlePublish() {
    setBusy(true);
    setStatus(null);
    const result = await publishAction({
      noteId: props.noteId,
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
    const result = await restoreAction({ noteId: props.noteId, versionNumber });
    setBusy(false);

    if (result.ok && result.revision !== undefined) {
      setRevision(result.revision);
      setStatus(`Restored version ${versionNumber}`);
      router.refresh();
      return;
    }
    setStatus(result.message ?? "Restore failed");
  }

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

        {status ? <p className="text-sm text-zinc-500">{status}</p> : null}

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
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={22}
            placeholder="Write in markdown. Fenced code blocks are supported."
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
                  <button
                    type="button"
                    onClick={() => handleRestore(version.versionNumber)}
                    disabled={busy}
                    title={`Restore v${version.versionNumber}`}
                    aria-label={`Restore v${version.versionNumber}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
