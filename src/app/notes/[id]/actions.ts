"use server";

import { revalidatePath } from "next/cache";
import { isDomainError, publishNote, restoreVersion, updateDraft } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";

export interface EditorActionResult {
  ok: boolean;
  revision?: number;
  conflict?: boolean;
  currentRevision?: number;
  message?: string;
}

export async function saveDraftAction(input: {
  noteId: string;
  title: string;
  content: string;
  baseRevision: number;
  shareToken?: string | null;
}): Promise<EditorActionResult> {
  const user = await requireUserOrRedirect();

  try {
    const draft = await updateDraft(getDb(), {
      noteId: input.noteId,
      userId: user.id,
      shareToken: input.shareToken,
      title: input.title,
      content: input.content,
      baseRevision: input.baseRevision,
    });
    revalidatePath(`/notes/${input.noteId}`);
    return { ok: true, revision: draft.revision };
  } catch (error) {
    if (isDomainError(error) && error.code === "conflict_revision") {
      const details = error.details as { current_revision?: number } | undefined;
      return { ok: false, conflict: true, currentRevision: details?.current_revision };
    }
    return { ok: false, message: isDomainError(error) ? error.message : "Save failed" };
  }
}

export async function publishAction(input: {
  noteId: string;
  message?: string;
  shareToken?: string | null;
}): Promise<EditorActionResult> {
  const user = await requireUserOrRedirect();

  try {
    const version = await publishNote(getDb(), {
      noteId: input.noteId,
      userId: user.id,
      shareToken: input.shareToken,
      message: input.message ?? null,
    });
    revalidatePath(`/notes/${input.noteId}`);
    return { ok: true, revision: version.versionNumber };
  } catch (error) {
    return { ok: false, message: isDomainError(error) ? error.message : "Publish failed" };
  }
}

export async function restoreAction(input: {
  noteId: string;
  versionNumber: number;
  shareToken?: string | null;
}): Promise<EditorActionResult> {
  const user = await requireUserOrRedirect();

  try {
    const { draft } = await restoreVersion(getDb(), {
      noteId: input.noteId,
      userId: user.id,
      shareToken: input.shareToken,
      versionNumber: input.versionNumber,
    });
    revalidatePath(`/notes/${input.noteId}`);
    return { ok: true, revision: draft.revision };
  } catch (error) {
    return { ok: false, message: isDomainError(error) ? error.message : "Restore failed" };
  }
}
