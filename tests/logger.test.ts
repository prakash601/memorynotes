import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/logger";

describe("structured logger", () => {
  it("writes one JSON line and redacts secrets", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    const log = createLogger({ service: "test", request_id: "req-1" });
    log.info("note.created", {
      authorization: "Bearer secret",
      nested: { token: "abc", safe: "ok" },
      safe: "value",
    });

    spy.mockRestore();

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.service).toBe("test");
    expect(parsed.authorization).toBe("[redacted]");
    expect((parsed.nested as Record<string, unknown>).token).toBe("[redacted]");
    expect((parsed.nested as Record<string, unknown>).safe).toBe("ok");
    expect(parsed.safe).toBe("value");
  });
});
