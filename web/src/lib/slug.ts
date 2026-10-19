/**
 * URL slugs for world servers.
 *
 * Servers have no stored slug column, so the slug is derived from the long
 * name. The same function runs on the server (resolving a URL) and in the
 * browser (building a link), so both sides agree without a DB change.
 *
 * "Clumsy's World [Velious Semi-Custom QoL+]" -> "clumsys-world-velious-semi-custom-qol"
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "server";
}

/** Path to a server's public page. */
export function serverPath(longName: string): string {
  return `/servers/${slugify(longName)}`;
}
