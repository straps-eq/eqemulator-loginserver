import DOMPurify from "isomorphic-dompurify";

// Operator-written profile HTML is shown on indexed server pages. Keep it to
// plain formatting and outbound links: no site CSS classes or sizing (which
// could fake our own sign-in UI), and every link opens off-site, marked as
// user content, over http(s) only.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) {
      node.removeAttribute("href");
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "nofollow ugc noopener noreferrer");
  }
});

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "p", "br", "b", "i", "em", "strong", "a", "ul", "ol", "li",
      "h3", "h4", "h5", "h6", "blockquote", "code", "pre",
      "span", "img", "hr",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title"],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}
