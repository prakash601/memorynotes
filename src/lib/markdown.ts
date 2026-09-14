import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * The only path from note content to HTML. Renders markdown with marked, then
 * passes it through a strict allowlist. Raw HTML in the source is discarded,
 * images become plain links (never inline), and link URLs are scheme-restricted.
 */
const ALLOWED_TAGS: string[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

function withSafeLinkAttributes(attribs: Record<string, string>): Record<string, string> {
  return { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" };
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    // rel and target are added by transformTags below, so they must be allowed
    // here or sanitize-html strips them again.
    a: ["href", "title", "rel", "target"],
    code: ["class"],
  },
  allowedClasses: {
    code: ["language-*"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: withSafeLinkAttributes(attribs) }),
    // An inline image would leak the reader's IP to a third party, so it is
    // rewritten as a plain link the reader must choose to follow.
    img: (_tagName, attribs) => ({
      tagName: "a",
      text: attribs.alt ? `[image: ${attribs.alt}]` : "[image]",
      attribs: withSafeLinkAttributes({ href: attribs.src ?? "#" }),
    }),
  },
};

export function renderMarkdown(source: string): string {
  const rawHtml = marked.parse(source, { async: false, gfm: true, breaks: false });
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}
