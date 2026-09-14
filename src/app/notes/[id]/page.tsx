import { notFound } from "next/navigation";
import { getOwnedNote, getShareView, isDomainError, listVersions } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";
import { buildShareUrl } from "@/lib/share-url";
import { NoteEditor } from "./note-editor";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

async function loadNote(db: ReturnType<typeof getDb>, id: string, userId: string) {
  const view = await getOwnedNote(db, id, userId);
  const versions = await listVersions(db, id, userId);
  const share = await getShareView(db, id, userId);
  return { view, versions, share };
}

export default async function NotePage({ params }: PageProps) {
  const user = await requireUserOrRedirect();
  const { id } = await params;

  const { view, versions, share } = await loadNote(getDb(), id, user.id).catch((error: unknown) => {
    if (isDomainError(error) && error.code === "not_found") {
      notFound();
    }
    throw error;
  });

  return (
    <NoteEditor
      noteId={id}
      initialTitle={view.draft?.title ?? ""}
      initialContent={view.draft?.content ?? ""}
      initialRevision={view.draft?.revision ?? 1}
      visibility={view.note.visibility}
      shareUrl={share?.rawToken ? buildShareUrl(share.rawToken) : null}
      publishedVersionNumber={view.publishedVersion?.versionNumber ?? null}
      versions={versions.map((version) => ({
        versionNumber: version.versionNumber,
        message: version.message,
        authorType: version.authorType,
        createdAt: version.createdAt.toISOString(),
      }))}
    />
  );
}
