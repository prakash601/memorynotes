import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

describe("markdown rendering", () => {
  it("renders headings, lists, and emphasis", () => {
    const html = renderMarkdown("# Title\n\n- one\n- two\n\n**bold**");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders fenced code blocks with a language class", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain('class="language-js"');
    expect(html).toContain("const a = 1;");
  });

  it("discards raw HTML", () => {
    const html = renderMarkdown("<script>alert('xss')</script>\n\n<div onclick='x'>hi</div>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<div");
  });

  it("rewrites images as plain links instead of inline assets", () => {
    const html = renderMarkdown("![a diagram](https://example.com/diagram.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("<a");
    expect(html).toContain("https://example.com/diagram.png");
    expect(html).toContain("[image: a diagram]");
  });

  it("marks external links safe", () => {
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it("strips dangerous URL schemes", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("keeps tables", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });
});
