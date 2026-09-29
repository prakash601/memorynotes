import type { ApiToken, Note, NoteDraft, NoteShare, NoteVersion, Report } from "@/db/schema";
import { buildShareUrl } from "./share-url";

export function serializeShare(share: NoteShare, rawToken: string | null) {
  return {
    url: rawToken ? buildShareUrl(rawToken) : null,
    access: share.access,
    prefix: share.tokenPrefix,
    expires_at: share.expiresAt,
    password_protected: share.passwordHash !== null,
    max_views: share.maxViews,
    views_count: share.viewsCount,
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
    is_favorite: note.isFavorite,
    is_pinned: note.isPinned,
    folder_id: note.folderId,
    published_version_id: note.publishedVersionId,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted_at: note.deletedAt,
  };
}

export function serializeReport(report: Report) {
  return {
    id: report.id,
    note_id: report.noteId,
    share_id: report.shareId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    resolution_note: report.resolutionNote,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
  };
}

/** Never exposes the token hash. The raw value is returned once, at creation. */
export function serializeApiToken(token: ApiToken) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.tokenPrefix,
    scopes: token.scopes,
    last_used_at: token.lastUsedAt,
    expires_at: token.expiresAt,
    created_at: token.createdAt,
  };
}
