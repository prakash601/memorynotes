import type { Note, NoteDraft, NoteShare, NoteVersion } from "@/db/schema";
import { buildShareUrl } from "./share-url";

export function serializeShare(share: NoteShare, rawToken: string | null) {
  return {
    url: rawToken ? buildShareUrl(rawToken) : null,
    access: share.access,
    prefix: share.tokenPrefix,
    expires_at: share.expiresAt,
  };
}

export function serializeVersionSummary(version: NoteVersion) {
  return {
    version_number: version.versionNumber,
    title: version.title,
    message: version.message,
    author_id: version.authorId,
    author_type: version.authorType,
    source: version.source,
    created_at: version.createdAt,
  };
}

export function serializeVersionDetail(version: NoteVersion) {
  return { ...serializeVersionSummary(version), content: version.content };
}

export function serializeDraft(draft: NoteDraft) {
  return {
    title: draft.title,
    content: draft.content,
    revision: draft.revision,
    updated_at: draft.updatedAt,
  };
}

export function serializeNote(note: Note) {
  return {
    id: note.id,
    visibility: note.visibility,
    published_version_id: note.publishedVersionId,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted_at: note.deletedAt,
  };
}
