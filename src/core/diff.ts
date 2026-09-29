/**
 * Line-based text diff for version history (issue #69).
 * Framework-free on purpose: no Next.js, React, or server-only imports
 * (ADR-0005). The HTTP adapter and UI both consume this shape.
 */
import { MAX_CONTENT_BYTES } from "./constants";
import { ContentTooLargeError } from "./errors";

export type DiffLineType = "same" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  /** 1-based line number in the old text, or null for additions. */
  oldLineNumber: number | null;
  /** 1-based line number in the new text, or null for deletions. */
  newLineNumber: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface TextDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  empty: boolean;
}

/** Number of context lines kept around each change when grouping hunks. */
export const DIFF_CONTEXT_LINES = 3;

/** Rejects diffs whose inputs together exceed the 1MiB content cap. */
export function assertDiffSize(oldText: string, newText: string): void {
  if (Buffer.byteLength(oldText, "utf8") + Buffer.byteLength(newText, "utf8") > MAX_CONTENT_BYTES) {
    throw new ContentTooLargeError();
  }
}

function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  return text.split("\n");
}

interface EditOp {
  type: DiffLineType;
  text: string;
  oldIndex: number | null;
  newIndex: number | null;
}

/**
 * Myers O(ND) diff over lines. Returns a flat edit script in order.
 * For note-sized texts this is fast; callers must enforce assertDiffSize
 * first so pathological inputs never reach here.
 */
function myers(oldLines: string[], newLines: string[]): EditOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  if (n === 0 && m === 0) {
    return [];
  }
  const max = n + m;
  const offset = max;
  let v = new Array<number>(2 * max + 1).fill(-1);
  v[offset + 1] = 0;
  const trace: number[][] = [];

  let found = false;
  for (let d = 0; d <= max; d++) {
    const current = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const idx = offset + k;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
        x = v[idx + 1];
      } else {
        x = v[idx - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      current[idx] = x;
      if (x >= n && y >= m) {
        trace.push(current);
        found = true;
        break;
      }
    }
    if (found) {
      break;
    }
    trace.push(current);
    v = current;
  }

  // Backtrack from (n, m) to (0, 0).
  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1];
    const k = x - y;
    const idx = offset + k;
    let prevK: number;
    if (k === -d || (k !== d && prev[idx - 1] < prev[idx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: "same", text: oldLines[x - 1], oldIndex: x - 1, newIndex: y - 1 });
      x--;
      y--;
    }
    if (d === 0) {
      break;
    }
    if (x === prevX) {
      ops.push({ type: "add", text: newLines[y - 1], oldIndex: null, newIndex: y - 1 });
      y--;
    } else {
      ops.push({ type: "del", text: oldLines[x - 1], oldIndex: x - 1, newIndex: null });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ type: "same", text: oldLines[x - 1], oldIndex: x - 1, newIndex: y - 1 });
    x--;
    y--;
  }
  while (x > 0) {
    ops.push({ type: "del", text: oldLines[x - 1], oldIndex: x - 1, newIndex: null });
    x--;
  }
  while (y > 0) {
    ops.push({ type: "add", text: newLines[y - 1], oldIndex: null, newIndex: y - 1 });
    y--;
  }
  return ops.reverse();
}

/** Groups a flat edit script into hunks with surrounding context. */
function toHunks(ops: EditOp[], context: number): DiffHunk[] {
  if (ops.length === 0) {
    return [];
  }
  const changeIndexes = ops.map((op, i) => (op.type === "same" ? -1 : i)).filter((i) => i >= 0);
  if (changeIndexes.length === 0) {
    return [];
  }
  const ranges: Array<[number, number]> = [];
  for (const idx of changeIndexes) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }
  return ranges.map(([start, end]) => {
    const slice = ops.slice(start, end + 1);
    const firstOld = slice.find((op) => op.oldIndex !== null);
    const firstNew = slice.find((op) => op.newIndex !== null);
    const oldCount = slice.filter((op) => op.oldIndex !== null).length;
    const newCount = slice.filter((op) => op.newIndex !== null).length;
    return {
      oldStart: firstOld ? firstOld.oldIndex! + 1 : 0,
      oldCount,
      newStart: firstNew ? firstNew.newIndex! + 1 : 0,
      newCount,
      lines: slice.map((op) => ({
        type: op.type,
        text: op.text,
        oldLineNumber: op.oldIndex !== null ? op.oldIndex + 1 : null,
        newLineNumber: op.newIndex !== null ? op.newIndex + 1 : null,
      })),
    };
  });
}

/**
 * Diffs two texts line by line. Identical inputs produce an empty diff
 * (`hunks: []`, `empty: true`). Throws ContentTooLargeError when the
 * combined inputs exceed the 1MiB cap.
 */
export function diffText(oldText: string, newText: string, context = DIFF_CONTEXT_LINES): TextDiff {
  assertDiffSize(oldText, newText);
  if (oldText === newText) {
    return { hunks: [], added: 0, removed: 0, empty: true };
  }
  const ops = myers(splitLines(oldText), splitLines(newText));
  const hunks = toHunks(ops, context);
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "add") {
      added++;
    } else if (op.type === "del") {
      removed++;
    }
  }
  return { hunks, added, removed, empty: hunks.length === 0 };
}
