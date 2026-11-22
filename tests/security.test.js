import test from "node:test";
import assert from "node:assert/strict";
import { validateSourceUrl } from "../src/core/security.js";

const code = u => validateSourceUrl(u).code;
test("accepts normal public HTTPS URLs", () => {
  for (const u of ["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://vimeo.com/123", "https://sub.example.co.uk/a/b?c=d#e"])
    assert.equal(validateSourceUrl(u).ok, true, u);
  assert.equal(validateSourceUrl("  https://youtu.be/abc  ").ok, true);
});
test("rejects non-HTTPS and non-URLs", () => {
  assert.equal(code("http://youtu.be/abc"), "URL_NOT_HTTPS");
  assert.equal(code("ftp://a.com/x"), "URL_NOT_HTTPS");
  assert.equal(code("file:///etc/passwd"), "URL_NOT_HTTPS");
  assert.equal(code("javascript:alert(1)"), "URL_NOT_HTTPS");
  assert.equal(code("not a url"), "URL_INVALID");
  assert.equal(code(""), "URL_INVALID");
  assert.equal(code(null), "URL_INVALID");
  assert.equal(code("https://a.com/\nx"), "URL_INVALID");
  assert.equal(code("https://a.com/" + "x".repeat(2100)), "URL_TOO_LONG");
});
test("rejects IP literals in every spelling (WHATWG URL normalises them)", () => {
  for (const u of ["https://127.0.0.1/", "https://10.0.0.5/x", "https://169.254.169.254/latest/meta-data", "https://192.168.1.1/",
    "https://2130706433/", "https://0x7f.1/", "https://127.1/", "https://017700000001/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://[fd00::1]/"])
    assert.equal(code(u), "URL_HOST_IP_LITERAL", u);
});
test("rejects internal hostnames", () => {
  for (const u of ["https://localhost/", "https://localhost./", "https://app.localhost/", "https://printer.local/", "https://db.internal/", "https://router.lan/", "https://intranet/", "https://metadata/"])
    assert.equal(code(u), "URL_HOST_INTERNAL", u);
});
test("rejects credentials and custom ports", () => {
  assert.equal(code("https://user:pw@a.com/"), "URL_HAS_CREDENTIALS");
  assert.equal(code("https://user@a.com/"), "URL_HAS_CREDENTIALS");
  assert.equal(code("https://a.com:8443/"), "URL_PORT_NOT_ALLOWED");
  assert.equal(validateSourceUrl("https://a.com:443/x").ok, true);
});
test("host tricks: userinfo lookalikes resolve to the real host", () => {
  const r = validateSourceUrl("https://youtube.com@evil.com/");
  assert.equal(r.ok, false);
  assert.equal(validateSourceUrl("https://evil.com/youtube.com").host, "evil.com");
});
test("allow/block lists match the host or its subdomains only", () => {
  const allowed = { allowedHosts: ["youtube.com", "youtu.be"] };
  assert.equal(validateSourceUrl("https://www.youtube.com/watch", allowed).ok, true);
  assert.equal(validateSourceUrl("https://youtu.be/x", allowed).ok, true);
  assert.equal(validateSourceUrl("https://notyoutube.com/x", allowed).code, "URL_HOST_NOT_ALLOWED");
  assert.equal(validateSourceUrl("https://youtube.com.evil.com/x", allowed).code, "URL_HOST_NOT_ALLOWED");
  assert.equal(validateSourceUrl("https://bad.example.com/x", { blockedHosts: ["example.com"] }).code, "URL_HOST_NOT_ALLOWED");
});
