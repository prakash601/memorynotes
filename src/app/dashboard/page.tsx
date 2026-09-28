import { Pin, RefreshCw, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { listNotes, listOwnedTags } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";
import { buildShareUrl } from "@/lib/share-url";
import {
  createNoteAction,
  deleteNoteAction,
  renameNoteAction,
  rotateShareAction,
  setExpiryAction,
  setTagsAction,
  setVisibilityAction,
  toggleFavoriteAction,
  togglePinnedAction,
} from "./actions";
import { CopyLinkButton } from "@/components/copy-link-button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Notes" };

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const selectClass =
  "h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const primaryButtonClass =
  "h-9 shrink-0 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const smallButtonClass =
  "h-9 shrink-0 rounded-md border border-zinc-300 px-3 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

type DashboardSearchParams = {
  q?: string;
  tag?: string;
  favorite?: string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const user = await requireUserOrRedirect();
  const params = await searchParams;
  const q = params.q?.trim() ? params.q.trim() : null;
  const tag = params.tag?.trim() ? params.tag.trim() : null;
  const favoriteOnly = params.favorite === "1" || params.favorite === "true";
  const [notes, allTags] = await Promise.all([
    listNotes(getDb(), user.id, { q, tag, favoriteOnly }),
    listOwnedTags(getDb(), user.id),
  ]);
  const filtering = q !== null || tag !== null || favoriteOnly;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">Notes</h1>
          <span className="text-sm text-zinc-500">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>
        </div>

        <form method="get" className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="q">
            Search notes
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search title or content"
            className={`${inputClass} max-w-xs`}
          />
          <label className="sr-only" htmlFor="tag">
            Filter by tag
          </label>
          <select id="tag" name="tag" defaultValue={tag ?? ""} className={selectClass}>
            <option value="">All tags</option>
            {allTags.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <label className="flex h-9 items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              name="favorite"
              value="1"
              defaultChecked={favoriteOnly}
              className="h-4 w-4"
            />
            Favorites
          </label>
          <button type="submit" className={smallButtonClass}>
            Filter
          </button>
          {filtering ? (
            <Link href="/dashboard" className={smallButtonClass}>
              Clear
            </Link>
          ) : null}
        </form>

        <form action={createNoteAction} className="flex gap-2">
          <label className="sr-only" htmlFor="new-title">
            New note title
          </label>
          <input id="new-title" name="title" placeholder="New note title" className={inputClass} />
          <button type="submit" className={primaryButtonClass}>
            Create
          </button>
        </form>

        {notes.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {filtering
              ? "No notes match these filters."
              : "No notes yet. Create one above and it will come with a share link."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {notes.map((note) => {
              const shareUrl = note.share?.rawToken ? buildShareUrl(note.share.rawToken) : null;

              return (
                <li key={note.id} className="flex flex-col gap-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/notes/${note.id}`} className="font-medium hover:underline">
                        {note.title || "Untitled"}
                      </Link>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {note.visibility} ·{" "}
                        {note.publishedVersionNumber
                          ? `published v${note.publishedVersionNumber}`
                          : "not published"}{" "}
                        · r{note.revision}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {shareUrl ? <CopyLinkButton url={shareUrl} /> : null}
                      <form action={toggleFavoriteAction}>
                        <input type="hidden" name="noteId" value={note.id} />
                        <button
                          type="submit"
                          title={note.isFavorite ? "Unfavorite" : "Favorite"}
                          aria-label={note.isFavorite ? "Unfavorite" : "Favorite"}
                          className={iconButtonClass}
                        >
                          <Star
                            className="h-4 w-4"
                            fill={note.isFavorite ? "currentColor" : "none"}
                          />
                        </button>
                      </form>
                      <form action={togglePinnedAction}>
                        <input type="hidden" name="noteId" value={note.id} />
                        <button
                          type="submit"
                          title={note.isPinned ? "Unpin" : "Pin to top"}
                          aria-label={note.isPinned ? "Unpin" : "Pin to top"}
                          className={iconButtonClass}
                        >
                          <Pin className="h-4 w-4" fill={note.isPinned ? "currentColor" : "none"} />
                        </button>
                      </form>
                      <form action={rotateShareAction}>
                        <input type="hidden" name="noteId" value={note.id} />
                        <button
                          type="submit"
                          title="Rotate link"
                          aria-label="Rotate link"
                          className={iconButtonClass}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      </form>
                      <form action={deleteNoteAction}>
                        <input type="hidden" name="noteId" value={note.id} />
                        <button
                          type="submit"
                          title="Delete note"
                          aria-label="Delete note"
                          className={iconButtonClass}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </form>
                    </div>
                  </div>

                  {shareUrl ? (
                    <p className="truncate font-mono text-xs text-zinc-500">{shareUrl}</p>
                  ) : (
                    <p className="text-xs text-zinc-500">
                      Link unavailable. Rotate to generate a new one.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <form action={setVisibilityAction} className="flex items-center gap-2">
                      <input type="hidden" name="noteId" value={note.id} />
                      <label className="sr-only" htmlFor={`vis-${note.id}`}>
                        Visibility
                      </label>
                      <select
                        id={`vis-${note.id}`}
                        name="visibility"
                        defaultValue={note.visibility}
                        className={selectClass}
                      >
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </select>
                      <button type="submit" className={smallButtonClass}>
                        Set
                      </button>
                    </form>

                    <form action={setExpiryAction} className="flex items-center gap-2">
                      <input type="hidden" name="noteId" value={note.id} />
                      <label className="sr-only" htmlFor={`exp-${note.id}`}>
                        Link expiry
                      </label>
                      <select
                        id={`exp-${note.id}`}
                        name="expiresIn"
                        defaultValue=""
                        className={selectClass}
                      >
                        <option value="" disabled>
                          Link expiry
                        </option>
                        <option value="1h">1 hour</option>
                        <option value="24h">24 hours</option>
                        <option value="7d">7 days</option>
                        <option value="30d">30 days</option>
                        <option value="90d">90 days</option>
                        <option value="never">Never</option>
                      </select>
                      <button type="submit" className={smallButtonClass}>
                        Set
                      </button>
                    </form>

                    <form action={renameNoteAction} className="flex items-center gap-2">
                      <input type="hidden" name="noteId" value={note.id} />
                      <label className="sr-only" htmlFor={`title-${note.id}`}>
                        Rename
                      </label>
                      <input
                        id={`title-${note.id}`}
                        name="title"
                        defaultValue={note.title}
                        placeholder="Rename"
                        className={`${inputClass} w-40`}
                      />
                      <button type="submit" className={smallButtonClass}>
                        Rename
                      </button>
                    </form>
                  </div>

                  {note.tags.length > 0 ? (
                    <p className="flex flex-wrap gap-1">
                      {note.tags.map((value) => (
                        <Link
                          key={value}
                          href={`/dashboard?tag=${encodeURIComponent(value)}`}
                          className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          {value}
                        </Link>
                      ))}
                    </p>
                  ) : null}

                  <form action={setTagsAction} className="flex items-center gap-2">
                    <input type="hidden" name="noteId" value={note.id} />
                    <label className="sr-only" htmlFor={`tags-${note.id}`}>
                      Tags (comma separated)
                    </label>
                    <input
                      id={`tags-${note.id}`}
                      name="tags"
                      defaultValue={note.tags.join(", ")}
                      placeholder="Tags, comma separated"
                      className={`${inputClass} w-52`}
                    />
                    <button type="submit" className={smallButtonClass}>
                      Save tags
                    </button>
                  </form>

                  {note.share?.expiresAt ? (
                    <p className="text-xs text-zinc-500">
                      Link expires {note.share.expiresAt.toISOString().slice(0, 10)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
