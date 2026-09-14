import { notFound } from "next/navigation";
import { getNoteView, getShareView, isDomainError, listVersions } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";
import { buildShareUrl } from "@/lib/share-url";
import { NoteEditor } from "./note-editor";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
};

async function loadNote(
  db: ReturnType<typeof getDb>,
  id: string,
  userId: string,
  shareToken: string | null,
) {
  const view = await getNoteView(db, id, userId, shareToken);
  const versions = await listVersions(db, id, userId, shareToken);
  // Only the owner can see the canonical link; a share editor already has it.
  const share = view.note.ownerId === userId ? await getShareView(db, id, userId) : null;
  return { view, versions, share };
}

export default async function NotePage({ params, searchParams }: PageProps) {
  const user = await requireUserOrRedirect();
  const { id } = await params;
  const { share: shareToken } = await searchParams;

  const { view, versions, share } = await loadNote(getDb(), id, user.id, shareToken ?? null).catch(
    (error: unknown) => {
      if (isDomainError(error) && error.code === "not_found") {
        notFound();
      }
      throw error;
    },
  );

  return (
    <NoteEditor
      noteId={id}
      shareToken={shareToken ?? null}
      isOwner={view.note.ownerId === user.id}
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
