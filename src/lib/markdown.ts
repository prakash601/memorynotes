import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * The only path from note content to HTML. Renders markdown with marked, then
 * passes it through a strict allowlist. Raw HTML in the source is discarded
 * and link URLs are scheme-restricted. Images stay inline only when they are
 * our own uploads (relative /uploads/ URLs, or the app origin when given);
 * anything else becomes a plain link, so external hosts never learn the
 * reader's IP. Task-list checkboxes survive as disabled inputs.
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
  "img",
  "input",
];

function withSafeLinkAttributes(attribs: Record<string, string>): Record<string, string> {
  return { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" };
}

function sanitizeOptions(selfOrigins: string[]): sanitizeHtml.IOptions {
  return {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      // rel and target are added by transformTags below, so they must be allowed
      // here or sanitize-html strips them again.
      a: ["href", "title", "rel", "target"],
      code: ["class"],
      img: ["src", "alt", "title", "loading"],
      // Task-list checkboxes from marked are always disabled; no other input
      // shape can reach here because raw HTML is discarded first.
      input: ["type", "checked", "disabled"],
    },
    allowedClasses: {
      code: ["language-*"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: withSafeLinkAttributes(attribs) }),
      // Our own uploads render inline. An external image would leak the
      // reader's IP to a third party, so it is rewritten as a plain link the
      // reader must choose to follow.
      img: (_tagName, attribs) => {
        if (isSelfImage(attribs.src, selfOrigins)) {
          const { src, alt, title } = attribs;
          return {
            tagName: "img",
            attribs: {
              src,
              ...(alt ? { alt } : {}),
              ...(title ? { title } : {}),
              loading: "lazy",
            },
          };
        }
        return {
          tagName: "a",
          text: attribs.alt ? `[image: ${attribs.alt}]` : "[image]",
          attribs: withSafeLinkAttributes({ href: attribs.src ?? "#" }),
        };
      },
      // Belt and braces: a checkbox that somehow arrives enabled is forced off.
      input: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, type: "checkbox", disabled: "disabled" },
      }),
    },
  };
}

/** True for relative /uploads/ URLs and for absolute URLs on our own origin. */
function isSelfImage(src: string | undefined, origins: string[]): boolean {
  if (!src) {
    return false;
  }
  if (src.startsWith("/uploads/")) {
    return true;
  }
  try {
    const parsed = new URL(src, "https://placeholder.invalid");
    if (parsed.origin === "https://placeholder.invalid") {
      return false;
    }
    return origins.includes(parsed.origin);
  } catch {
    return false;
  }
}

export interface RenderMarkdownOptions {
  /**
   * Origins treated as first-party for images (e.g. the app URL), in addition
   * to relative /uploads/ URLs which are always first-party.
   */
  appOrigin?: string;
}

export function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): string {
  const rawHtml = marked.parse(source, { async: false, gfm: true, breaks: false });
  const origins = options.appOrigin ? [options.appOrigin] : [];
  return sanitizeHtml(rawHtml, sanitizeOptions(origins));
}
