import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * Local-disk image store for note uploads (issue #71). Single-instance
 * deployment keeps files beside the app; the seam (dir + file layout) is
 * deliberately tiny so an object store can replace it later.
 */

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR?.trim() || join(process.cwd(), "uploads");
}

/** Storage key: `<uuid>.<ext>`. Rejects anything that is not exactly that. */
export function assertSafeImageKey(name: string): { id: string; ext: string } {
  const match =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp)$/.exec(
      name,
    );
  if (!match) {
    throw new Error("Unknown image");
  }
  return { id: match[1], ext: match[2] };
}

function filePath(name: string): string {
  const dir = resolve(uploadsDir());
  const full = resolve(dir, name);
  if (full !== join(dir, name) || !full.startsWith(dir + sep)) {
    throw new Error("Unknown image");
  }
  return full;
}

export async function saveImageFile(name: string, bytes: Uint8Array): Promise<void> {
  assertSafeImageKey(name);
  await mkdir(uploadsDir(), { recursive: true });
  await writeFile(filePath(name), bytes);
}

export async function readImageFile(name: string): Promise<Buffer | null> {
  try {
    assertSafeImageKey(name);
    return await readFile(filePath(name));
  } catch {
    return null;
  }
}

/** Best-effort: missing files are fine, other errors are swallowed by callers. */
export async function deleteImageFile(name: string): Promise<void> {
  try {
    assertSafeImageKey(name);
    await rm(filePath(name), { force: true });
  } catch {
    // Orphan sweep continues past individual failures.
  }
}
