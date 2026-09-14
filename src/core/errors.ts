/**
 * Domain errors. Framework-free on purpose: src/core must not import Next.js,
 * React, or server-only (ADR-0005), so it can be extracted into its own
 * service later. Transport layers map these to HTTP responses.
 */
export type DomainErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "gone"
  | "conflict_revision"
  | "lease_held"
  | "lease_expired"
  | "validation"
  | "content_too_large"
  | "moderation_blocked"
  | "rate_limited"
  | "email_not_verified";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: DomainErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Authentication required") {
    super("unauthorized", 401, message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Not permitted") {
    super("forbidden", 403, message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super("not_found", 404, message);
  }
}

export class GoneError extends DomainError {
  constructor(message = "This link is no longer available") {
    super("gone", 410, message);
  }
}

export class ConflictRevisionError extends DomainError {
  constructor(currentRevision: number) {
    super("conflict_revision", 409, "The note changed since this edit started", {
      current_revision: currentRevision,
    });
  }
}

export class LeaseHeldError extends DomainError {
  constructor() {
    super("lease_held", 409, "Another writer holds the lease for this note");
  }
}

export class LeaseExpiredError extends DomainError {
  constructor() {
    super("lease_expired", 409, "The lease expired and was released");
  }
}

export class ValidationError extends DomainError {
  constructor(message = "Validation failed", details?: unknown) {
    super("validation", 422, message, details);
  }
}

export class ContentTooLargeError extends DomainError {
  constructor() {
    super("content_too_large", 422, "Content exceeds the maximum size");
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
