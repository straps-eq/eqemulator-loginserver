/**
 * Application version.
 *
 * The release pipeline stamps the image with the git tag at build time
 * (`--build-arg APP_VERSION=<tag without v>` → `ENV APP_VERSION`), so the
 * running container reports the version it was actually built from. Local and
 * dev builds without the build arg fall back to web/package.json.
 */
import pkg from "../../package.json";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Strip a leading "v" and whitespace; return null if not a semver string. */
export function normalizeVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(/^v/i, "");
  return SEMVER_RE.test(s) ? s : null;
}

export const PACKAGE_VERSION: string = pkg.version;
export const APP_VERSION: string =
  normalizeVersion(process.env.APP_VERSION) || PACKAGE_VERSION;

/** Federation protocol revision this build speaks (reported in heartbeats). */
export const FEDERATION_PROTOCOL = 2;

/**
 * Compare two versions. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Pre-release / build suffixes are ignored ("1.7.0-rc.1" == "1.7.0").
 * Unparseable versions sort lowest.
 */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = normalizeVersion(a);
  const pb = normalizeVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const ca = pa.replace(/[-+].*$/, "").split(".").map(Number);
  const cb = pb.replace(/[-+].*$/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((ca[i] || 0) < (cb[i] || 0)) return -1;
    if ((ca[i] || 0) > (cb[i] || 0)) return 1;
  }
  return 0;
}

/** True if `v` is a parseable version strictly below `min`. */
export function isVersionBelow(v: string | null | undefined, min: string): boolean {
  return normalizeVersion(v) !== null && compareVersions(v, min) < 0;
}
