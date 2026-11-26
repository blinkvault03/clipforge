/**
 * A small DOM stand-in built from index.html itself. It is strict on purpose: getElementById returns null for
 * an id that is not in the markup (exactly like a browser), so a script that touches a missing element throws
 * during the test instead of in production.
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const html = readFileSync(join(root, "index.html"), "utf8");
export const moduleScript = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];

class ClassList {
  constructor() { this.s = new Set(); }
  add(...n) { n.forEach(x => this.s.add(x)); } remove(...n) { n.forEach(x => this.s.delete(x)); }
  toggle(n, f) { const on = f === undefined ? !this.s.has(n) : !!f; on ? this.s.add(n) : this.s.delete(n); return on; }
  contains(n) { return this.s.has(n); }
}
export class FakeEl {
  constructor(tag = "div", id = null) {
    this.tagName = tag.toUpperCase(); this.id = id; this.value = ""; this.checked = false; this.hidden = false; this.disabled = false;
    this._text = ""; this.innerHTML = ""; this.style = {}; this.dataset = {}; this.classList = new ClassList(); this.children = []; this.files = []; this.selectedOptions = [];
    this.attrs = {}; this.listeners = {};
  }
  get textContent() { return this._text; } set textContent(v) { this._text = String(v); this.children = []; }
  get className() { return [...this.classList.s].join(" "); } set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get childElementCount() { return this.children.length; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); } removeEventListener() {}
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; }
  append(...n) { this.children.push(...n); } prepend(...n) { this.children.unshift(...n); } replaceChildren(...n) { this.children = n; }
  querySelectorAll() { return []; } querySelector() { return null; } closest() { return null; }
  scrollIntoView() { this.scrolled = true; } focus() { this.focused = true; } select() {} remove() {} play() { return Promise.resolve(); } pause() {}
  click() { this.fire("click"); }
  fire(ev, extra = {}) { const e = { type: ev, target: this, preventDefault() {}, stopPropagation() {}, ...extra }; this["on" + ev]?.(e); (this.listeners[ev] || []).forEach(f => f(e)); }
}

/** Build the fake page and import the app script. Returns helpers for the test. */
export async function bootApp({ storage = {} } = {}) {
  const els = new Map();
  const idRe = /<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g;
  let m;
  while ((m = idRe.exec(html))) {
    const [, tag, a, id, b] = m, el = new FakeEl(tag, id), attrs = a + " " + b;
    const val = /\svalue="([^"]*)"/.exec(attrs); if (val) el.value = val[1];
    if (/\schecked(\s|$)/.test(attrs)) el.checked = true; if (/\shidden(\s|>|$)/.test(attrs)) el.hidden = true; if (/\sdisabled(\s|$)/.test(attrs)) el.disabled = true;
    els.set(id, el);
  }
  // <select> defaults = first option's value (or the one marked selected); <option> text as fallback
  for (const sm of html.matchAll(/<select[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const opts = [...sm[2].matchAll(/<option([^>]*)>([^<]*)<\/option>/g)]; if (!opts.length) continue;
    const pick = opts.find(o => /\sselected/.test(o[1])) || opts[0], v = /value="([^"]*)"/.exec(pick[1]);
    els.get(sm[1]).value = v ? v[1] : pick[2];
  }
  const navLinks = [...html.matchAll(/<a class="cf-nav[^"]*" href="(#[^"]+)"/g)].map(x => { const a = new FakeEl("a"); a.attrs.href = x[1]; return a; });
  els.get("cfSidebar").querySelectorAll = sel => /a\.cf-nav/.test(sel) ? navLinks : [];
  const platformButtons = [...html.matchAll(/data-open-platform="([^"]+)"/g)].map(x => { const b = new FakeEl("button"); b.dataset.openPlatform = x[1]; return b; });
  const docListeners = {};
  const doc = {
    getElementById: id => els.get(id) || null,
    createElement: t => new FakeEl(t), createTextNode: t => ({ nodeType: 3, textContent: t }),
    querySelectorAll: s => s === "[data-open-platform]" ? platformButtons : [], querySelector: () => null,
    addEventListener: (ev, fn) => { (docListeners[ev] ||= []).push(fn); },
    body: new FakeEl("body"), head: new FakeEl("head")
  };
  const mem = { ...storage };
  const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const winListeners = {};
  const g = globalThis;
  const saved = {};
  const set = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(g, k); Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); };
  set("document", doc); set("window", g); set("localStorage", ls); set("location", { hostname: "user.github.io", origin: "https://user.github.io" });
  set("navigator", { clipboard: { writeText: async () => {} } }); set("confirm", () => true); set("innerWidth", 1200);
  g.addEventListener = (ev, fn) => { (winListeners[ev] ||= []).push(fn); };
  const file = join(root, `.app-under-test-${process.pid}.mjs`);
  writeFileSync(file, moduleScript);
  try { await import(pathToFileURL(file).href + "?t=" + Date.now()); } finally { rmSync(file, { force: true }); }
  return {
    $: id => { const e = els.get(id); if (!e) throw new Error("no element #" + id); return e; }, els, mem, doc, navLinks, platformButtons,
    pressKey: key => (docListeners.keydown || []).forEach(f => f({ key })), resize: () => (winListeners.resize || []).forEach(f => f()),
    restore() { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(g, k, d); else delete g[k]; } delete g.addEventListener; }
  };
}
