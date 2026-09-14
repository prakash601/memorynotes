"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createNote,
  getOwnedNote,
  rotateShare,
  setVisibility,
  softDeleteNote,
  updateDraft,
  updateShare,
  type ShareExpiryOption,
} from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";

export async function createNoteAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  const title = String(formData.get("title") ?? "");
  const { note } = await createNote(getDb(), { ownerId: user.id, title });
  revalidatePath("/dashboard");
  redirect(`/notes/${note.id}`);
}

export async function renameNoteAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  const noteId = String(formData.get("noteId") ?? "");
  const title = String(formData.get("title") ?? "");
  const view = await getOwnedNote(getDb(), noteId, user.id);

  if (view.draft) {
    await updateDraft(getDb(), {
      noteId,
      userId: user.id,
      title,
      content: view.draft.content,
      baseRevision: view.draft.revision,
    });
  }
  revalidatePath("/dashboard");
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  await softDeleteNote(getDb(), {
    noteId: String(formData.get("noteId") ?? ""),
    ownerId: user.id,
  });
  revalidatePath("/dashboard");
}

export async function rotateShareAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  await rotateShare(getDb(), {
    noteId: String(formData.get("noteId") ?? ""),
    ownerId: user.id,
  });
  revalidatePath("/dashboard");
}

export async function setVisibilityAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  await setVisibility(getDb(), {
    noteId: String(formData.get("noteId") ?? ""),
    ownerId: user.id,
    visibility: String(formData.get("visibility") ?? "unlisted"),
  });
  revalidatePath("/dashboard");
}

export async function setExpiryAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  const expiresIn = String(formData.get("expiresIn") ?? "30d") as ShareExpiryOption;
  await updateShare(getDb(), {
    noteId: String(formData.get("noteId") ?? ""),
    ownerId: user.id,
    expiresIn,
  });
  revalidatePath("/dashboard");
}
