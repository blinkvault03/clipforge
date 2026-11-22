/**
 * Source-URL validation (SSRF defence, layer 1: syntax + host rules).
 * LIMITS: this inspects the URL text only. It cannot see what a hostname resolves to (no DNS in a Worker),
 * so any component that itself fetches user URLs must ALSO block private/loopback/link-local addresses at
 * connection time. Today the Worker never fetches the URL — the third-party provider does.
 * Validation does not prove the user is allowed to clip the source; rights/licence checks are separate.
 */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".intranet", ".corp", ".home.arpa"];

export function validateSourceUrl(raw, { allowedHosts, blockedHosts = [] } = {}) {
  const fail = (code, message) => ({ ok: false, code, message });
  if (typeof raw !== "string" || !raw.trim()) return fail("URL_INVALID", "A URL is required.");
  const text = raw.trim();
  if (text.length > 2048) return fail("URL_TOO_LONG", "URL is too long.");
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return fail("URL_INVALID", "URL contains whitespace or control characters.");
  let u;
  try { u = new URL(text); } catch { return fail("URL_INVALID", "Not a valid URL."); }
  if (u.protocol !== "https:") return fail("URL_NOT_HTTPS", "Only HTTPS URLs are allowed.");
  if (u.username || u.password) return fail("URL_HAS_CREDENTIALS", "URLs with embedded credentials are not allowed.");
  if (u.port) return fail("URL_PORT_NOT_ALLOWED", "Custom ports are not allowed.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return fail("URL_HOST_IP_LITERAL", "IP-address hosts are not allowed.");
  const labels = host.split(".");
  if (labels.length < 2 || /^\d+$/.test(labels[labels.length - 1])) return fail("URL_HOST_INTERNAL", "Host must be a public domain name.");
  if (host === "localhost" || BLOCKED_SUFFIXES.some(s => host.endsWith(s))) return fail("URL_HOST_INTERNAL", "Internal hostnames are not allowed.");
  const match = list => list.some(h => host === h.toLowerCase() || host.endsWith("." + h.toLowerCase()));
  if (match(blockedHosts)) return fail("URL_HOST_NOT_ALLOWED", "This host is blocked.");
  if (Array.isArray(allowedHosts) && allowedHosts.length && !match(allowedHosts)) return fail("URL_HOST_NOT_ALLOWED", "This host is not on the allowed list.");
  return { ok: true, url: u.toString(), host };
}
