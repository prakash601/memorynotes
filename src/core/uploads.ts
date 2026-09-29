/**
 * Image upload validation for note markdown (issue #71). Framework-free:
 * magic-byte sniffing over raw bytes, so the check cannot be fooled by a
 * lying filename or Content-Type. SVG is rejected outright (scriptable),
 * as is anything that is not a raster still we can serve safely.
 */
import { ValidationError } from "./errors";

/** 5 MiB per image, per issue #71. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const TYPE_EXTENSIONS: Record<AllowedImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function sniffContentType(bytes: Uint8Array): AllowedImageType | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF87a / GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: RIFF .... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export interface ValidatedImage {
  contentType: AllowedImageType;
  extension: string;
  sizeBytes: number;
}

/**
 * Accepts only genuine raster stills. The declared Content-Type must agree
 * with the sniffed magic bytes: an .exe renamed to .png, or an SVG with
 * embedded script, is rejected either way.
 */
export function validateImageUpload(
  bytes: Uint8Array,
  declaredType: string | null | undefined,
): ValidatedImage {
  if (bytes.length === 0) {
    throw new ValidationError("Image is empty");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ValidationError("Image must be 5 MiB or smaller");
  }
  const sniffed = sniffContentType(bytes);
  if (!sniffed) {
    throw new ValidationError("Unsupported image type: only PNG, JPEG, GIF, and WebP are allowed");
  }
  const declared = (declaredType ?? "").split(";")[0].trim().toLowerCase();
  if (declared && declared !== sniffed) {
    throw new ValidationError("Image content does not match its declared type");
  }
  return { contentType: sniffed, extension: TYPE_EXTENSIONS[sniffed], sizeBytes: bytes.length };
}

/** Storage filename for an image row: `<uuid>.<ext>`. */
export function imageFileName(image: { id: string; contentType: string }): string {
  const ext =
    (Object.entries(TYPE_EXTENSIONS) as Array<[string, string]>).find(
      ([type]) => type === image.contentType,
    )?.[1] ?? "bin";
  return `${image.id}.${ext}`;
}
