import DOMPurify from "isomorphic-dompurify";

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "p", "br", "b", "i", "em", "strong", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre",
      "span", "div", "img", "hr",
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "src", "alt", "title", "class", "width", "height",
    ],
    ADD_ATTR: ["target"],
  });
}
